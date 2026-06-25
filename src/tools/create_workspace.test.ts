import { describe, it, expect, vi } from "vitest";
import { createWorkspace } from "./create_workspace.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("create_workspace", () => {
  it("sends the base body without a github block when repo fields are absent", async () => {
    const client = mockClient({ createWorkspace: vi.fn().mockResolvedValue({}) });
    await createWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      name: "infra",
      ruleset_ids: ["rs_1"],
    });

    const [enterpriseId, body] = client.createWorkspace.mock.calls[0];
    expect(enterpriseId).toBe("ent_1");
    expect(body).toMatchObject({ name: "infra", ruleset_ids: ["rs_1"] });
    expect(body).not.toHaveProperty("github");
  });

  it("includes the github block only when all four repo fields are present", async () => {
    const client = mockClient({ createWorkspace: vi.fn().mockResolvedValue({}) });
    await createWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      name: "infra",
      github_installation_id: "inst_1",
      github_owner: "owner",
      github_repo: "name",
      github_branch: "main",
    });

    const [, body] = client.createWorkspace.mock.calls[0];
    expect(body.github).toEqual({
      installation_id: "inst_1",
      owner: "owner",
      repo: "name",
      branch: "main",
    });
  });

  it("omits the github block when the repo fields are only partial", async () => {
    const client = mockClient({ createWorkspace: vi.fn().mockResolvedValue({}) });
    await createWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      name: "infra",
      github_installation_id: "inst_1",
      github_owner: "owner",
      // repo and branch missing
    });

    const [, body] = client.createWorkspace.mock.calls[0];
    expect(body).not.toHaveProperty("github");
  });
});
