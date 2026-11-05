import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalWorkspace, bindLocalWorkspace } from "./local-workspace.js";
import { mockClient, mockContext } from "../test-helpers.js";

const directories: string[] = [];

async function gitDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "icb-local-workspace-"));
  directories.push(directory);
  execFileSync("git", ["init", directory]);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local Git workspaces", () => {
  it("creates a local-Git workspace, binds it, and writes a non-secret project marker", async () => {
    const directory = await gitDirectory();
    const client = mockClient({
      createWorkspace: vi.fn().mockResolvedValue({ workspace: { id: "ws_local" } }),
      bindLocalWorkspace: vi.fn().mockResolvedValue({ bound_at: "2026-11-05T00:00:00.000Z" }),
    });

    const result = await createLocalWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      name: "Local foundations",
      directory,
    });

    expect(client.createWorkspace).toHaveBeenCalledWith(
      "ent_1",
      expect.objectContaining({ name: "Local foundations", development_mode: "local_git" })
    );
    expect(client.bindLocalWorkspace).toHaveBeenCalledWith(
      "ent_1",
      "ws_local",
      expect.objectContaining({ binding_id: expect.any(String), local_identity: expect.any(String) })
    );
    expect(result).toMatchObject({ workspace: { id: "ws_local" } });
    expect(JSON.parse(await readFile(join(directory, ".infracodebase", "workspace.json"), "utf8"))).toMatchObject({
      workspace_id: "ws_local",
      version: 1,
    });
  });

  it("refuses to silently replace a binding for another workspace", async () => {
    const directory = await gitDirectory();
    const client = mockClient({
      createWorkspace: vi.fn().mockResolvedValue({ workspace: { id: "ws_first" } }),
      bindLocalWorkspace: vi.fn().mockResolvedValue({}),
    });
    await createLocalWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      name: "First",
      directory,
    });

    await expect(
      bindLocalWorkspace.run(mockContext({ client }), { workspace_id: "ws_other", directory })
    ).rejects.toThrow("already bound");
  });
});
