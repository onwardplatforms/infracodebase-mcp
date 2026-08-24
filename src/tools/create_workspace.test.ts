import { describe, it, expect, vi } from "vitest";
import { createWorkspace } from "./create_workspace.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("create_workspace", () => {
  it("sends the base body without a repository block when repo fields are absent", async () => {
    const client = mockClient({ createWorkspace: vi.fn().mockResolvedValue({}) });
    await createWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      name: "infra",
      ruleset_ids: ["rs_1"],
    });

    const [enterpriseId, body] = client.createWorkspace.mock.calls[0];
    expect(enterpriseId).toBe("ent_1");
    expect(body).toMatchObject({ name: "infra", ruleset_ids: ["rs_1"] });
    expect(body).not.toHaveProperty("repository");
  });

  it("includes the repository block only when all three repo fields are present", async () => {
    const client = mockClient({ createWorkspace: vi.fn().mockResolvedValue({}) });
    await createWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      name: "infra",
      connection_id: "conn_1",
      repo_path: "acme/platform/network",
      branch: "main",
    });

    const [, body] = client.createWorkspace.mock.calls[0];
    expect(body.repository).toEqual({
      connection_id: "conn_1",
      path: "acme/platform/network",
      branch: "main",
    });
  });

  // Every partial combination must reject — the guard is all-or-nothing and
  // field-agnostic, so cover both the one-field and two-field cases to lock
  // that in against a refactor to hard-coded per-field checks.
  it.each([
    { name: "connection_id only", repo: { connection_id: "conn_1" } },
    { name: "repo_path only", repo: { repo_path: "acme/platform" } },
    { name: "branch only", repo: { branch: "main" } },
    {
      name: "connection_id + repo_path, no branch",
      repo: { connection_id: "conn_1", repo_path: "acme/platform" },
    },
    {
      name: "connection_id + branch, no repo_path",
      repo: { connection_id: "conn_1", branch: "main" },
    },
    {
      name: "repo_path + branch, no connection_id",
      repo: { repo_path: "acme/platform", branch: "main" },
    },
  ])("rejects a partial repo link ($name) instead of silently omitting it", async ({ repo }) => {
    const client = mockClient({ createWorkspace: vi.fn().mockResolvedValue({}) });
    await expect(
      createWorkspace.run(mockContext({ client }), {
        enterprise_id: "ent_1",
        name: "infra",
        ...repo,
      })
    ).rejects.toThrow(/all of connection_id, repo_path, and branch/);

    expect(client.createWorkspace).not.toHaveBeenCalled();
  });
});
