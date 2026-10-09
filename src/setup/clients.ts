/**
 * The MCP clients `infracodebase init` can configure, how each one is
 * detected, and how the infracodebase server entry is written into it.
 *
 * Clients with their own CLI (Claude Code, Codex) are configured through that
 * CLI so we never hand-edit their private state. The rest are JSON files we
 * merge one entry into, leaving every other server untouched.
 */

import { spawn } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_API_URL } from "../config.js";

export const SERVER_NAME = "infracodebase";

/** The command an MCP client runs to start this server. */
export interface ServerLaunch {
  command: string;
  args: string[];
}

export interface SetupEnv {
  home: string;
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows. */
  appData?: string;
  /** $XDG_CONFIG_HOME on Linux. */
  xdgConfigHome?: string;
  /** Where Codex keeps config.toml; defaults to ~/.codex. */
  codexHome?: string;
  /** Where Claude Code keeps .claude.json; defaults to the home folder. */
  claudeConfigDir?: string;
  /** True when `command` resolves on PATH. */
  hasCommand: (command: string) => Promise<boolean>;
  run: (command: string, args: string[]) => Promise<{ code: number; output: string }>;
}

export type InstallResult =
  | { ok: true; detail: string; restart: boolean }
  | { ok: false; detail: string; manual: string };

export interface McpClient {
  id: string;
  label: string;
  /** Operating systems the client ships on; omitted means all of them. */
  platforms?: NodeJS.Platform[];
  detect: (env: SetupEnv) => Promise<boolean>;
  /**
   * The API URL of the client's existing infracodebase entry, or undefined
   * when it has none. Read-only: never changes the client's config.
   */
  existingApiUrl: (env: SetupEnv) => Promise<string | undefined>;
  install: (env: SetupEnv, launch: ServerLaunch) => Promise<InstallResult>;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readText(target: string): Promise<string | undefined> {
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

export function normalizeApiUrl(value: string): string {
  return value.replace(/\/$/, "");
}

/**
 * The instance an existing server entry talks to: its `--api-url` argument,
 * then an INFRACODEBASE_API_URL env var, then the SaaS default.
 */
export function entryApiUrl(entry: unknown): string {
  if (!entry || typeof entry !== "object") return DEFAULT_API_URL;
  const { args, env } = entry as { args?: unknown; env?: unknown };
  if (Array.isArray(args)) {
    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]);
      if (arg === "--api-url" && typeof args[i + 1] === "string") return normalizeApiUrl(args[i + 1]);
      if (arg.startsWith("--api-url=")) return normalizeApiUrl(arg.slice("--api-url=".length));
    }
  }
  if (env && typeof env === "object") {
    const fromEnv = (env as Record<string, unknown>).INFRACODEBASE_API_URL;
    if (typeof fromEnv === "string" && fromEnv) return normalizeApiUrl(fromEnv);
  }
  return DEFAULT_API_URL;
}

function apiUrlOf(entry: unknown): string | undefined {
  return entry === undefined ? undefined : entryApiUrl(entry);
}

/** The infracodebase entry under `key` in a JSON config file, if any. */
async function jsonServerEntry(filePath: string, key: string): Promise<unknown> {
  const text = await readText(filePath);
  if (text === undefined) return undefined;
  try {
    const servers = (JSON.parse(text) as Record<string, unknown>)?.[key];
    return servers && typeof servers === "object" ? (servers as Record<string, unknown>)[SERVER_NAME] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The infracodebase entry in Codex's config.toml. Only `args` and `env` are
 * needed to tell which instance it targets, so this reads the
 * `[mcp_servers.infracodebase]` table and its `.env` subtable without a full
 * TOML parser.
 */
export function codexServerEntry(toml: string): unknown {
  const tables = new Map<string, string>();
  let current: string | undefined;
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$/.exec(line);
    if (header) {
      current = header[1].replace(/["']/g, "");
      tables.set(current, "");
    } else if (current) {
      tables.set(current, `${tables.get(current)}${line}\n`);
    }
  }
  const body = tables.get(`mcp_servers.${SERVER_NAME}`);
  if (body === undefined) return undefined;

  const strings = (text: string) => [...text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
  const argsMatch = /^\s*args\s*=\s*\[([\s\S]*?)\]/m.exec(body);
  const envText = tables.get(`mcp_servers.${SERVER_NAME}.env`) ?? /^\s*env\s*=\s*\{([^}]*)\}/m.exec(body)?.[1] ?? "";
  const envUrl = /INFRACODEBASE_API_URL\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(envText);
  return {
    args: argsMatch ? strings(argsMatch[1]) : [],
    env: envUrl ? { INFRACODEBASE_API_URL: envUrl[1] ?? envUrl[2] } : {},
  };
}

function tildify(env: SetupEnv, target: string): string {
  return target.startsWith(env.home + path.sep) ? `~${target.slice(env.home.length)}` : target;
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandLine(parts: string[]): string {
  return parts.map(shellQuote).join(" ");
}

/** Per-user application config folder: ~/Library/Application Support, %APPDATA%, or $XDG_CONFIG_HOME. */
export function appConfigDir(env: SetupEnv): string {
  if (env.platform === "darwin") return path.join(env.home, "Library", "Application Support");
  if (env.platform === "win32") return env.appData ?? path.join(env.home, "AppData", "Roaming");
  return env.xdgConfigHome || path.join(env.home, ".config");
}

/**
 * Merge `entry` into `config[key][SERVER_NAME]` in a JSON file, creating the
 * file if needed. An existing file is backed up to `<file>.bak` first, and a
 * file that is not plain JSON (for example JSONC with comments) is left alone.
 */
export async function mergeJsonServer(
  filePath: string,
  key: string,
  entry: Record<string, unknown>
): Promise<"created" | "updated" | "unchanged"> {
  let original: string | undefined;
  try {
    original = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let config: Record<string, unknown> = {};
  if (original !== undefined && original.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(original);
    } catch {
      throw new Error("it isn't plain JSON, for example it has comments");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("it isn't a JSON object");
    }
    config = parsed as Record<string, unknown>;
  }

  const existingServers = config[key];
  if (existingServers !== undefined && (typeof existingServers !== "object" || existingServers === null || Array.isArray(existingServers))) {
    throw new Error(`its "${key}" setting isn't an object`);
  }
  const servers = (existingServers ?? {}) as Record<string, unknown>;
  if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(entry)) return "unchanged";

  const next = { ...config, [key]: { ...servers, [SERVER_NAME]: entry } };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (original !== undefined) await fs.writeFile(`${filePath}.bak`, original);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(temporaryPath, filePath);
  return servers[SERVER_NAME] === undefined ? "created" : "updated";
}

function jsonClient(options: {
  id: string;
  label: string;
  platforms?: NodeJS.Platform[];
  /** Folder whose presence means the client is installed. */
  installDir: (env: SetupEnv) => string;
  configFile: (env: SetupEnv) => string;
  key: string;
  entry: (launch: ServerLaunch) => Record<string, unknown>;
}): McpClient {
  return {
    id: options.id,
    label: options.label,
    platforms: options.platforms,
    detect: (env) => exists(options.installDir(env)),
    existingApiUrl: async (env) => apiUrlOf(await jsonServerEntry(options.configFile(env), options.key)),
    async install(env, launch) {
      const file = options.configFile(env);
      const entry = options.entry(launch);
      try {
        const outcome = await mergeJsonServer(file, options.key, entry);
        return {
          ok: true,
          detail:
            outcome === "unchanged"
              ? `already set up in ${tildify(env, file)}`
              : `${outcome === "created" ? "added to" : "updated in"} ${tildify(env, file)}`,
          restart: outcome !== "unchanged",
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          detail: `couldn't update ${tildify(env, file)}: ${reason}. It was left unchanged.`,
          manual: `Add this under "${options.key}" in ${tildify(env, file)}:\n${JSON.stringify(
            { [SERVER_NAME]: entry },
            null,
            2
          )}`,
        };
      }
    },
  };
}

function cliClient(options: {
  id: string;
  label: string;
  binary: string;
  /** Reads the client's existing entry from its own config, without running it. */
  readEntry: (env: SetupEnv) => Promise<unknown>;
  removeArgs: string[];
  addArgs: (launch: ServerLaunch) => string[];
  installHint: string;
}): McpClient {
  return {
    id: options.id,
    label: options.label,
    detect: (env) => env.hasCommand(options.binary),
    existingApiUrl: async (env) => apiUrlOf(await options.readEntry(env)),
    async install(env, launch) {
      const addArgs = options.addArgs(launch);
      const manual = `Run: ${commandLine([options.binary, ...addArgs])}`;
      if (!(await env.hasCommand(options.binary))) {
        return { ok: false, detail: `\`${options.binary}\` is not installed. ${options.installHint}`, manual };
      }
      // Replace any earlier entry so a re-run picks up a new API URL.
      await env.run(options.binary, options.removeArgs);
      const added = await env.run(options.binary, addArgs);
      if (added.code !== 0) {
        return { ok: false, detail: added.output.trim() || `\`${options.binary}\` exited with ${added.code}`, manual };
      }
      return { ok: true, detail: "added for every project", restart: false };
    },
  };
}

export const CLIENTS: McpClient[] = [
  cliClient({
    id: "claude-code",
    label: "Claude Code",
    binary: "claude",
    // User-scope servers live at the top level of ~/.claude.json.
    readEntry: (env) =>
      jsonServerEntry(path.join(env.claudeConfigDir || env.home, ".claude.json"), "mcpServers"),
    removeArgs: ["mcp", "remove", SERVER_NAME, "--scope", "user"],
    addArgs: (launch) => ["mcp", "add", SERVER_NAME, "--scope", "user", "--", launch.command, ...launch.args],
    installHint: "Install Claude Code, then run init again.",
  }),
  jsonClient({
    id: "cursor",
    label: "Cursor",
    installDir: (env) => path.join(env.home, ".cursor"),
    configFile: (env) => path.join(env.home, ".cursor", "mcp.json"),
    key: "mcpServers",
    entry: (launch) => ({ command: launch.command, args: launch.args }),
  }),
  jsonClient({
    id: "vscode",
    label: "VS Code",
    installDir: (env) => path.join(appConfigDir(env), "Code", "User"),
    configFile: (env) => path.join(appConfigDir(env), "Code", "User", "mcp.json"),
    key: "servers",
    entry: (launch) => ({ type: "stdio", command: launch.command, args: launch.args }),
  }),
  jsonClient({
    id: "claude-desktop",
    label: "Claude Desktop",
    // There is no Linux build.
    platforms: ["darwin", "win32"],
    installDir: (env) => path.join(appConfigDir(env), "Claude"),
    configFile: (env) => path.join(appConfigDir(env), "Claude", "claude_desktop_config.json"),
    key: "mcpServers",
    entry: (launch) => ({ command: launch.command, args: launch.args }),
  }),
  jsonClient({
    id: "windsurf",
    label: "Windsurf",
    installDir: (env) => path.join(env.home, ".codeium", "windsurf"),
    configFile: (env) => path.join(env.home, ".codeium", "windsurf", "mcp_config.json"),
    key: "mcpServers",
    entry: (launch) => ({ command: launch.command, args: launch.args }),
  }),
  cliClient({
    id: "codex",
    label: "Codex CLI",
    binary: "codex",
    readEntry: async (env) => {
      const toml = await readText(path.join(env.codexHome || path.join(env.home, ".codex"), "config.toml"));
      return toml === undefined ? undefined : codexServerEntry(toml);
    },
    removeArgs: ["mcp", "remove", SERVER_NAME],
    addArgs: (launch) => ["mcp", "add", SERVER_NAME, "--", launch.command, ...launch.args],
    installHint: "Install the Codex CLI, then run init again.",
  }),
];

/** The clients that exist on this operating system, in display order. */
export function clientsFor(platform: NodeJS.Platform): McpClient[] {
  return CLIENTS.filter((client) => !client.platforms || client.platforms.includes(platform));
}

export function findClient(id: string): McpClient | undefined {
  return CLIENTS.find((client) => client.id === id);
}

/** Quote one argument for cmd.exe. */
function windowsQuote(value: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`;
}

function runCommand(command: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    // Windows CLIs installed through npm are .cmd shims, which only run
    // through cmd.exe, and Node does not quote arguments passed alongside
    // `shell: true`, so build the quoted command line ourselves.
    const child =
      process.platform === "win32"
        ? spawn([command, ...args].map(windowsQuote).join(" "), { stdio: ["ignore", "pipe", "pipe"], shell: true })
        : spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", (error) => resolve({ code: 1, output: error.message }));
    child.once("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function onPath(command: string): Promise<boolean> {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      if (await exists(path.join(directory, command + extension.toLowerCase()))) return true;
      if (extension && (await exists(path.join(directory, command + extension)))) return true;
    }
  }
  return false;
}

export function systemSetupEnv(home: string): SetupEnv {
  return {
    home,
    platform: process.platform,
    appData: process.env.APPDATA,
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
    codexHome: process.env.CODEX_HOME,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    hasCommand: onPath,
    run: runCommand,
  };
}
