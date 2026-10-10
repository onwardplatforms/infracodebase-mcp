import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appConfigDir,
  clientsFor,
  codexServerEntry,
  entryApiUrl,
  findClient,
  mergeJsonServer,
  type SetupEnv,
} from "./clients.js";

const NEXTERA = "https://nextera.example.com/api/v1";
const launch = { command: "npx", args: ["-y", "@infracodebase/mcp@latest", "--api-url", NEXTERA] };
const temporaryDirectories: string[] = [];

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "infracodebase-setup-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeEnv(home: string, overrides: Partial<SetupEnv> = {}): SetupEnv {
  return {
    home,
    platform: "darwin",
    hasCommand: async () => false,
    run: async () => ({ code: 0, output: "" }),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("mergeJsonServer", () => {
  it("adds the server next to existing ones and backs up the original", async () => {
    const home = await temporaryHome();
    const file = path.join(home, "mcp.json");
    const original = JSON.stringify({ theme: "dark", mcpServers: { github: { command: "gh-mcp" } } });
    await writeFile(file, original);

    await expect(mergeJsonServer(file, "mcpServers", { command: "npx" })).resolves.toBe("created");

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      theme: "dark",
      mcpServers: { github: { command: "gh-mcp" }, infracodebase: { command: "npx" } },
    });
    expect(await readFile(`${file}.bak`, "utf8")).toBe(original);
  });

  it("creates the file and its folder when the client has no config yet", async () => {
    const home = await temporaryHome();
    const file = path.join(home, "nested", "mcp.json");

    await expect(mergeJsonServer(file, "servers", { command: "npx" })).resolves.toBe("created");

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      servers: { infracodebase: { command: "npx" } },
    });
  });

  it("leaves the file untouched when the entry already matches", async () => {
    const home = await temporaryHome();
    const file = path.join(home, "mcp.json");
    const original = `{"mcpServers":{"infracodebase":{"command":"npx"}}}`;
    await writeFile(file, original);

    await expect(mergeJsonServer(file, "mcpServers", { command: "npx" })).resolves.toBe("unchanged");

    expect(await readFile(file, "utf8")).toBe(original);
    await expect(readFile(`${file}.bak`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to rewrite a config it cannot parse, such as JSON with comments", async () => {
    const home = await temporaryHome();
    const file = path.join(home, "mcp.json");
    const original = `{\n  // my servers\n  "servers": {}\n}`;
    await writeFile(file, original);

    await expect(mergeJsonServer(file, "servers", { command: "npx" })).rejects.toThrow("has comments");

    expect(await readFile(file, "utf8")).toBe(original);
  });
});

describe("existing config detection", () => {
  it("reads the instance from --api-url, then INFRACODEBASE_API_URL, then the SaaS default", () => {
    expect(entryApiUrl({ args: ["-y", "pkg", "--api-url", `${NEXTERA}/`] })).toBe(NEXTERA);
    expect(entryApiUrl({ args: [`--api-url=${NEXTERA}`] })).toBe(NEXTERA);
    expect(entryApiUrl({ args: [], env: { INFRACODEBASE_API_URL: NEXTERA } })).toBe(NEXTERA);
    expect(entryApiUrl({ args: ["-y", "@infracodebase/mcp@2"] })).toBe("https://infracodebase.com/api/v1");
  });

  it("finds the Codex entry and its env subtable without touching other servers", () => {
    const toml = `
model = "o3"

[mcp_servers.other]
command = "other"
args = ["--api-url", "https://wrong.example.com/api/v1"]

[mcp_servers.infracodebase]
command = "npx"
args = [
  "-y",
  "@infracodebase/mcp@latest",
]

[mcp_servers.infracodebase.env]
INFRACODEBASE_API_URL = "${NEXTERA}"
`;
    expect(entryApiUrl(codexServerEntry(toml))).toBe(NEXTERA);
    expect(codexServerEntry(`[mcp_servers.other]\ncommand = "x"\n`)).toBeUndefined();
  });

  it("reports which instance a JSON client's existing entry uses", async () => {
    const home = await temporaryHome();
    const env = fakeEnv(home);
    const cursor = findClient("cursor")!;
    const file = path.join(home, ".cursor", "mcp.json");

    expect(await cursor.existingApiUrl(env)).toBeUndefined();

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ mcpServers: { infracodebase: { command: "npx", args: ["-y", "@infracodebase/mcp@2"] } } })
    );
    expect(await cursor.existingApiUrl(env)).toBe("https://infracodebase.com/api/v1");

    await cursor.install(env, launch);
    expect(await cursor.existingApiUrl(env)).toBe(NEXTERA);
  });

  it("reads Claude Code's user-scope server from ~/.claude.json", async () => {
    const home = await temporaryHome();
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        projects: { "/repo": { mcpServers: { infracodebase: { command: "npx", args: launch.args } } } },
      })
    );
    const claude = findClient("claude-code")!;

    // A project-scoped entry only works in that repo, so it does not count.
    expect(await claude.existingApiUrl(fakeEnv(home))).toBeUndefined();

    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { infracodebase: { type: "stdio", command: "npx", args: launch.args } } })
    );
    expect(await claude.existingApiUrl(fakeEnv(home))).toBe(NEXTERA);
  });
});

describe("CLI-managed clients", () => {
  it("replaces any earlier Claude Code entry with a user-scope one", async () => {
    const run = vi.fn(async () => ({ code: 0, output: "" }));
    const env = fakeEnv(await temporaryHome(), { hasCommand: async () => true, run });

    await expect(findClient("claude-code")!.install(env, launch)).resolves.toMatchObject({ ok: true });

    expect(run.mock.calls).toEqual([
      ["claude", ["mcp", "remove", "infracodebase", "--scope", "user"]],
      ["claude", ["mcp", "add", "infracodebase", "--scope", "user", "--", "npx", ...launch.args]],
    ]);
  });

  it("hands back the exact command when the client CLI is missing or fails", async () => {
    const home = await temporaryHome();

    const missing = await findClient("codex")!.install(fakeEnv(home), launch);
    expect(missing).toMatchObject({ ok: false });
    expect(missing.ok ? "" : missing.manual).toBe(
      `Run: codex mcp add infracodebase -- npx -y @infracodebase/mcp@latest --api-url ${NEXTERA}`
    );

    const failing = await findClient("codex")!.install(
      fakeEnv(home, {
        hasCommand: async () => true,
        run: async (_command, args) =>
          args[1] === "add" ? { code: 2, output: "config.toml is read-only\n" } : { code: 0, output: "" },
      }),
      launch
    );
    expect(failing).toMatchObject({ ok: false, detail: "config.toml is read-only" });
  });
});

describe("operating systems", () => {
  it("offers Claude Desktop only where it ships", () => {
    expect(clientsFor("linux").map((client) => client.id)).toEqual([
      "claude-code",
      "cursor",
      "vscode",
      "windsurf",
      "codex",
    ]);
    expect(clientsFor("win32").map((client) => client.id)).toContain("claude-desktop");
    expect(clientsFor("darwin").map((client) => client.id)).toContain("claude-desktop");
  });

  it("finds per-user app config in the right folder on each OS", () => {
    const home = path.join(path.sep, "users", "ada");
    expect(appConfigDir(fakeEnv(home, { platform: "darwin" }))).toBe(
      path.join(home, "Library", "Application Support")
    );
    expect(
      appConfigDir(fakeEnv(home, { platform: "win32", appData: path.join(home, "AppData", "Roaming") }))
    ).toBe(path.join(home, "AppData", "Roaming"));
    expect(appConfigDir(fakeEnv(home, { platform: "linux" }))).toBe(path.join(home, ".config"));
    expect(appConfigDir(fakeEnv(home, { platform: "linux", xdgConfigHome: path.join(home, "xdg") }))).toBe(
      path.join(home, "xdg")
    );
  });

  it("writes VS Code's config under %APPDATA% on Windows and $XDG_CONFIG_HOME on Linux", async () => {
    const home = await temporaryHome();
    const vscode = findClient("vscode")!;

    const windows = fakeEnv(home, { platform: "win32", appData: path.join(home, "Roaming") });
    await vscode.install(windows, launch);
    expect(await readFile(path.join(home, "Roaming", "Code", "User", "mcp.json"), "utf8")).toContain(NEXTERA);

    const linux = fakeEnv(home, { platform: "linux", xdgConfigHome: path.join(home, "xdg") });
    await vscode.install(linux, launch);
    expect(await vscode.existingApiUrl(linux)).toBe(NEXTERA);
    expect(await readFile(path.join(home, "xdg", "Code", "User", "mcp.json"), "utf8")).toContain(NEXTERA);
  });

  it("reads Codex and Claude Code config from CODEX_HOME and CLAUDE_CONFIG_DIR when set", async () => {
    const home = await temporaryHome();
    const codexHome = path.join(home, "codex-elsewhere");
    const claudeDir = path.join(home, "claude-elsewhere");
    await mkdir(codexHome, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      path.join(codexHome, "config.toml"),
      `[mcp_servers.infracodebase]\ncommand = "npx"\nargs = ["--api-url", "${NEXTERA}"]\n`
    );
    await writeFile(
      path.join(claudeDir, ".claude.json"),
      JSON.stringify({ mcpServers: { infracodebase: { command: "npx", args: launch.args } } })
    );
    const env = fakeEnv(home, { codexHome, claudeConfigDir: claudeDir });

    expect(await findClient("codex")!.existingApiUrl(env)).toBe(NEXTERA);
    expect(await findClient("claude-code")!.existingApiUrl(env)).toBe(NEXTERA);
  });
});
