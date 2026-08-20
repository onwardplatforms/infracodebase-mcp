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

  it("omits the repository block when the repo fields are only partial", async () => {
    const client = mockClient({ createWorkspace: vi.fn().mockResolvedValue({}) });
    await createWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      name: "infra",
      connection_id: "conn_1",
      // repo_path and branch missing
    });

    const [, body] = client.createWorkspace.mock.calls[0];
    expect(body).not.toHaveProperty("repository");
  });
});
