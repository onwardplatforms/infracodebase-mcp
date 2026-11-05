import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import type { ToolDef } from "./helpers.js";

type LocalMarker = { workspace_id: string; binding_id: string; version: 1 };

function gitRoot(directory?: string): Promise<string> {
  const cwd = resolve(directory ?? process.cwd());
  return new Promise((resolveRoot, reject) => {
    execFile("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        reject(new Error("This folder is not a Git repository. Run git init and create a commit before binding it."));
        return;
      }
      resolveRoot(String(stdout).trim());
    });
  });
}

function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile("git", ["-C", root, ...args], { timeout: 30_000 }, (err, stdout) => {
      if (err) return reject(new Error(`Git could not prepare the committed snapshot: ${err.message}`));
      resolveOutput(String(stdout).trim());
    });
  });
}

async function writeMarker(root: string, workspaceId: string, bindingId: string) {
  const markerPath = join(root, ".infracodebase", "workspace.json");
  await mkdir(dirname(markerPath), { recursive: true });
  const marker: LocalMarker = { workspace_id: workspaceId, binding_id: bindingId, version: 1 };
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return markerPath;
}

async function existingMarker(root: string): Promise<LocalMarker | null> {
  try {
    const value = JSON.parse(await readFile(join(root, ".infracodebase", "workspace.json"), "utf8"));
    if (value?.version === 1 && typeof value.workspace_id === "string" && typeof value.binding_id === "string") return value;
  } catch {
    // No marker means this is the first bind. A malformed marker is deliberately replaced only after
    // the user asks to bind, never during an unrelated MCP read.
  }
  return null;
}

export const bindLocalWorkspace: ToolDef = {
  name: "bind_local_workspace",
  async run({ client, getEnterpriseForWorkspace }, a) {
    const root = await gitRoot(a.directory);
    const existing = await existingMarker(root);
    if (existing && existing.workspace_id !== a.workspace_id) {
      throw new Error(
        `This Git repository is already bound to workspace ${existing.workspace_id}. Rebind only after confirming the workspace change.`
      );
    }
    const bindingId = existing?.binding_id ?? randomUUID();
    const enterpriseId = await getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const result = await client.bindLocalWorkspace(enterpriseId, a.workspace_id, {
      binding_id: bindingId,
      // This is an opaque per-checkout identifier, not a local filesystem path.
      local_identity: bindingId,
    });
    const markerPath = await writeMarker(root, a.workspace_id, bindingId);
    return { ...((result ?? {}) as object), workspace_id: a.workspace_id, marker_path: markerPath };
  },
};

export const createLocalWorkspace: ToolDef = {
  name: "create_local_workspace",
  async run({ client }, a) {
    const root = await gitRoot(a.directory);
    const created = (await client.createWorkspace(a.enterprise_id, {
      name: a.name,
      description: a.description,
      ruleset_ids: a.ruleset_ids,
      development_mode: "local_git",
    })) as { workspace?: { id?: string } };
    const workspaceId = created.workspace?.id;
    if (!workspaceId) throw new Error("The server did not return a workspace ID for the local workspace.");
    const bindingId = randomUUID();
    const bound = await client.bindLocalWorkspace(a.enterprise_id, workspaceId, {
      binding_id: bindingId,
      local_identity: bindingId,
    });
    const markerPath = await writeMarker(root, workspaceId, bindingId);
    return { ...created, local_binding: bound, marker_path: markerPath };
  },
};

export const submitLocalComplianceSnapshot: ToolDef = {
  name: "submit_local_compliance_snapshot",
  async run({ client, getEnterpriseForWorkspace }, a) {
    const root = await gitRoot(a.directory);
    const marker = await existingMarker(root);
    if (!marker || marker.workspace_id !== a.workspace_id) {
      throw new Error("Bind this Git repository to the workspace before submitting local compliance.");
    }
    const commitSha = await git(root, ["rev-parse", "HEAD"]);
    const branch = await git(root, ["branch", "--show-current"]);
    const bundlePath = join(tmpdir(), `icb-${randomUUID()}.bundle`);
    try {
      await git(root, ["bundle", "create", bundlePath, "HEAD"]);
      const bundle = await readFile(bundlePath);
      if (bundle.length > 20 * 1024 * 1024) {
        throw new Error("The committed Git snapshot exceeds the 20 MB local compliance limit.");
      }
      const enterpriseId = await getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
      return await client.submitLocalSnapshot(enterpriseId, a.workspace_id, {
        binding_id: marker.binding_id,
        commit_sha: commitSha,
        ...(branch ? { branch } : {}),
        bundle_base64: bundle.toString("base64"),
      });
    } finally {
      await rm(bundlePath, { force: true });
    }
  },
};
