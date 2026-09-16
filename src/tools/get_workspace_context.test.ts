import { describe, it, expect, vi } from "vitest";
import { getWorkspaceContext } from "./get_workspace_context.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_workspace_context", () => {
  it("uses one request for an empty folder with enterprise drafting context", async () => {
    const response = {
      status: "unlinked",
      can_generate: true,
      rulesets: [{ title: "Security", rules: [{ content: "Encrypt volumes" }] }],
      modules: { entries: [] },
    };
    const client = mockClient({ getBuildContext: vi.fn().mockResolvedValue(response) });
    const result = await getWorkspaceContext.run(mockContext({ client }), {
      iac_tool: "terraform",
    });
    expect(result).toMatchObject(response);
    expect(client.getBuildContext).toHaveBeenCalledExactlyOnceWith({
      repoUrl: undefined,
      workspaceId: undefined,
      enterpriseId: undefined,
      rulesetIds: undefined,
      iacTool: "terraform",
      branch: undefined,
    });
    expect(client.listEnterprises).not.toHaveBeenCalled();
  });
  it("uses the detected remote and makes detection visible", async () => {
    const client = mockClient({
      getBuildContext: vi.fn().mockResolvedValue({ status: "linked", can_generate: true }),
    });
    const ctx = mockContext({
      client,
      resolveRepoUrl: vi
        .fn()
        .mockResolvedValue({ repo_url: "git@gitlab.com:org/project.git", resolved_from: "roots" }),
    });
    expect(
      await getWorkspaceContext.run(ctx, { branch: "feature", enterprise_id: "ent" })
    ).toMatchObject({
      resolved_repo_url: "git@gitlab.com:org/project.git",
      resolved_from: "roots",
    });
    expect(client.getBuildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: "git@gitlab.com:org/project.git",
        branch: "feature",
        enterpriseId: "ent",
      })
    );
  });
  it.each(["no_access", "needs_enterprise", "ambiguous"])(
    "preserves the %s generation gate",
    async (status) => {
      const response = { status, can_generate: false, message: "Resolve before drafting" };
      const client = mockClient({ getBuildContext: vi.fn().mockResolvedValue(response) });
      const ctx = mockContext({ client });
      expect(await getWorkspaceContext.run(ctx, { workspace_id: "ws" })).toEqual(response);
      expect(ctx.resolveRepoUrl).not.toHaveBeenCalled();
    }
  );
  it("does not fall back to enterprise context after a Git error", async () => {
    const ctx = mockContext({ resolveRepoUrl: vi.fn().mockRejectedValue(new Error("Git failed")) });
    await expect(getWorkspaceContext.run(ctx, {})).rejects.toThrow("Git failed");
    expect(ctx.client.getBuildContext).not.toHaveBeenCalled();
  });
});
