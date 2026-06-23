/**
 * Configuration file management for ~/.infracodebase/config.json
 */

import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";

const ConfigSchema = z.object({
  apiUrl: z.string().url().default("https://infracodebase.com/api/v1"),
  apiToken: z.string().min(1),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_API_URL = "https://infracodebase.com/api/v1";
export const CONFIG_DIR = join(homedir(), ".infracodebase");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface ConfigOverrides {
  token?: string;
  apiUrl?: string;
}

/**
 * Read and parse the config file if it exists. Returns an empty object when
 * the file is absent so callers can layer flags/env on top of it.
 */
async function readConfigFile(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Could not read ${CONFIG_PATH}: ${(error as Error).message}\n` +
        `The file may be malformed JSON. Fix it or run 'infracodebase auth logout' to reset.`
    );
  }
}

/**
 * Resolve effective configuration.
 *
 * Token/URL precedence (highest first): explicit flags > environment variables
 * > config file > defaults. This lets you run the server with just a flag or
 * env var, no config file required.
 */
export async function loadConfig(overrides: ConfigOverrides = {}): Promise<Config> {
  const fileConfig = await readConfigFile();

  const apiToken =
    overrides.token ?? process.env.INFRACODEBASE_TOKEN ?? (fileConfig.apiToken as string | undefined);
  const apiUrl =
    overrides.apiUrl ??
    process.env.INFRACODEBASE_API_URL ??
    (fileConfig.apiUrl as string | undefined) ??
    DEFAULT_API_URL;

  if (!apiToken) {
    throw new Error(
      `No infracodebase token found.\n\n` +
        `Set one up in one command:\n` +
        `  INFRACODEBASE_TOKEN=your_token npx @infracodebase/mcp init\n\n` +
        `Or pass it directly:\n` +
        `  infracodebase --token=your_token\n\n` +
        `Get your token from: https://infracodebase.com/settings/tokens`
    );
  }

  return ConfigSchema.parse({ ...fileConfig, apiToken, apiUrl });
}

/**
 * Save configuration to ~/.infracodebase/config.json
 */
export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600, // rw------- (owner only)
  });
}

export interface ConfigPatch {
  apiUrl?: string;
  apiToken?: string;
}

/**
 * Merge a patch into the persisted config and save it, leaving untouched fields
 * (and the token) intact. Requires an existing config - you need a token first.
 * Returns the validated, saved config.
 */
export async function updateConfig(patch: ConfigPatch): Promise<Config> {
  const existing = await readConfigFile();
  if (!existing.apiToken) {
    throw new Error(`No config found at ${CONFIG_PATH}. Run 'infracodebase init' first.`);
  }
  const merged = {
    ...existing,
    ...(patch.apiUrl !== undefined && { apiUrl: patch.apiUrl }),
    ...(patch.apiToken !== undefined && { apiToken: patch.apiToken }),
  };
  const config = ConfigSchema.parse(merged);
  await saveConfig(config);
  return config;
}

/**
 * Remove the persisted configuration. Returns true if a file was deleted.
 */
export async function deleteConfig(): Promise<boolean> {
  try {
    await rm(CONFIG_PATH);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const CLIENT_SNIPPET = `{
  "mcpServers": {
    "infracodebase": {
      "command": "npx",
      "args": ["-y", "@infracodebase/mcp"]
    }
  }
}`;

/**
 * One-command setup: validate the token against the API, persist it, then
 * print copy-paste install instructions per client.
 *
 * We deliberately validate *before* saving so a typo'd or expired token fails
 * loudly here rather than silently 401-ing inside the user's editor later.
 */
export async function initializeSetup(overrides: ConfigOverrides = {}): Promise<void> {
  console.log("infracodebase MCP setup\n");

  const token = overrides.token ?? process.env.INFRACODEBASE_TOKEN;
  const apiUrl = overrides.apiUrl ?? process.env.INFRACODEBASE_API_URL ?? DEFAULT_API_URL;

  // Step 1: token present?
  console.log("Step 1/3: API token");
  if (!token) {
    console.error("  Error: no token provided.");
    console.error("  Get one: https://infracodebase.com/settings/tokens");
    console.error("  Then run: INFRACODEBASE_TOKEN=your_token npx @infracodebase/mcp init");
    process.exit(1);
  }
  console.log(`  Token: ${maskToken(token)}\n`);

  // Step 2: validate against the API before persisting anything.
  console.log("Step 2/3: Validate token");
  const { InfracodebaseClient } = await import("./client.js");
  const client = new InfracodebaseClient({ baseUrl: apiUrl, token });

  let enterprises: Array<{ id?: string; name?: string }>;
  try {
    enterprises = await client.verifyToken();
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) {
      console.error(`  Error: token rejected (HTTP ${status}). It may be invalid or expired.`);
      console.error("  Get a fresh one: https://infracodebase.com/settings/tokens");
    } else {
      console.error(`  Error: could not reach ${apiUrl}`);
      console.error(`  ${(error as Error).message}`);
    }
    process.exit(1);
  }

  const names = enterprises.map((e) => e.name).filter(Boolean);
  const summary =
    enterprises.length === 0
      ? "no enterprises yet"
      : `${enterprises.length} enterprise${enterprises.length === 1 ? "" : "s"}${
          names.length ? `: ${names.join(", ")}` : ""
        }`;
  console.log(`  Valid - ${summary}`);

  // Persist only after a successful validation.
  await saveConfig({ apiUrl, apiToken: token });
  console.log(`  Saved to ${CONFIG_PATH}\n`);

  // Step 3: client install instructions (don't guess paths - print what works).
  console.log("Step 3/3: Connect your MCP client\n");
  console.log("  Claude Code (run this in your terminal):");
  console.log("    claude mcp add infracodebase -- npx -y @infracodebase/mcp\n");
  console.log("  Claude Desktop / Cursor / Continue.dev (add to the MCP config):");
  console.log(CLIENT_SNIPPET.split("\n").map((l) => `    ${l}`).join("\n"));
  console.log();

  console.log("Setup complete. Restart your MCP client and the 'infracodebase'");
  console.log("server will be available.\n");
  console.log("  Verify:  infracodebase auth status");
  console.log("  Docs:    https://docs.infracodebase.com/mcp");
}

/** Mask a token for display: keep a short prefix, hide the rest. */
export function maskToken(token: string): string {
  if (token.length <= 12) return "*".repeat(token.length);
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}
