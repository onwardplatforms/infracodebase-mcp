import { describe, it, expect, vi } from "vitest";
import { setupWorkspace } from "./setup_workspace.js";
import { mockClient, mockContext } from "../test-helpers.js";

const args = {
  enterprise_id: "ent",
  ruleset_ids: ["required", "optional"],
  branch: "feature/queue",
};
const draft = {
  status: "unlinked",
  can_generate: true,
  repository: { host: "gitlab.com", displayPath: "team/sub/repo", name: "repo" },
  setup: { enterprise_id: "ent", ruleset_ids: args.ruleset_ids },
};
const linked = {
  status: "linked",
  can_generate: true,
  workspace: { id: "existing" },
  setup: draft.setup,
};
function scenario() {
  const client = mockClient({
    getBuildContext: vi.fn().mockResolvedValueOnce(draft).mockResolvedValue(linked),
    listVcsConnections: vi.fn().mockResolvedValue({
      data: [
        { id: "vcs", host: "gitlab.com", provider: "gitlab" },
        { id: "other", host: "self-hosted.example", provider: "gitlab" },
      ],
    }),
    listVcsRepos: vi
      .fn()
      .mockResolvedValue({
        data: [{ path: "team/sub/repo", web_url: "https://gitlab.com/team/sub/repo" }],
      }),
    createWorkspace: vi
      .fn()
      .mockResolvedValue({ workspace: { id: "existing" }, repository_linked: true }),
  });
  const ctx = mockContext({
    client,
    resolveRepoUrl: vi
      .fn()
      .mockResolvedValue({ repo_url: "git@gitlab.com:team/sub/repo.git", resolved_from: "cwd" }),
  });
  return { client, ctx };
}

describe("draft-to-workspace handoff", () => {
  it("carries the drafting selection into repository-bound creation and verifies effective rules", async () => {
    const { ctx, client } = scenario();
    expect(await setupWorkspace.run(ctx, args)).toMatchObject({ status: "ready", context: linked });
    expect(client.createWorkspace).toHaveBeenCalledExactlyOnceWith("ent", {
      name: "repo",
      ruleset_ids: ["required", "optional"],
      repository: { connection_id: "vcs", path: "team/sub/repo", branch: "feature/queue" },
    });
    expect(client.listVcsRepos).toHaveBeenCalledExactlyOnceWith("ent", "vcs", "repo");
    expect(client.getBuildContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: "existing", branch: "feature/queue" })
    );
    expect(client.triggerComplianceEvaluation).not.toHaveBeenCalled();
  });
  it("reuses linked workspaces without changing their rules or creating duplicates", async () => {
    const { ctx, client } = scenario();
    client.getBuildContext.mockReset().mockResolvedValue(linked);
    expect(await setupWorkspace.run(ctx, args)).toMatchObject({
      status: "already_linked",
      context: linked,
    });
    expect(client.createWorkspace).not.toHaveBeenCalled();
    expect(client.updateWorkspaceResources).not.toHaveBeenCalled();
    expect(client.listVcsConnections).not.toHaveBeenCalled();
  });
  it("creates nothing while the project has no remote", async () => {
    const ctx = mockContext();
    expect(await setupWorkspace.run(ctx, args)).toMatchObject({ status: "no_repository" });
    expect(ctx.client.createWorkspace).not.toHaveBeenCalled();
  });
  it.each(["no_access", "needs_enterprise"])("preserves the %s gate", async (status) => {
    const { ctx, client } = scenario();
    client.getBuildContext.mockReset().mockResolvedValue({ status, can_generate: false });
    expect(await setupWorkspace.run(ctx, args)).toMatchObject({ status, can_generate: false });
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });
  it("does not turn VCS failures into missing-repo instructions", async () => {
    const { ctx, client } = scenario();
    client.listVcsRepos.mockRejectedValue(new Error("Token revoked"));
    await expect(setupWorkspace.run(ctx, args)).rejects.toThrow("Token revoked");
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });
  it("asks only when repository access is absent or connections are ambiguous", async () => {
    const { ctx, client } = scenario();
    client.getBuildContext.mockReset().mockResolvedValue(draft);
    client.listVcsRepos.mockResolvedValue({ data: [] });
    expect(await setupWorkspace.run(ctx, args)).toMatchObject({
      status: "repository_access_required",
    });
    client.listVcsRepos.mockResolvedValue({ data: [{ path: "team/sub/repo" }] });
    client.listVcsConnections.mockResolvedValue({
      data: [
        { id: "one", host: "gitlab.com", provider: "gitlab" },
        { id: "two", host: "gitlab.com", provider: "gitlab" },
      ],
    });
    expect(await setupWorkspace.run(ctx, args)).toMatchObject({ status: "needs_connection" });
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });
  it.each([
    { repository_linked: false, repository_error: "Clone failed" },
    { repository_linked: true, warning: "Hook registration failed" },
  ])("keeps the created workspace ID when setup is incomplete (%j)", async (failure) => {
    const { ctx, client } = scenario();
    client.createWorkspace.mockResolvedValue({ workspace: { id: "created" }, ...failure });
    expect(await setupWorkspace.run(ctx, args)).toMatchObject({
      status: "setup_incomplete",
      workspace: { id: "created" },
      ...failure,
    });
    expect(client.createWorkspace).toHaveBeenCalledTimes(1);
    expect(client.getBuildContext).toHaveBeenCalledTimes(1);
  });
  it("does not report readiness if a selected rule was lost during setup", async () => {
    const { ctx, client } = scenario();
    client.getBuildContext
      .mockReset()
      .mockResolvedValueOnce(draft)
      .mockResolvedValue({ ...linked, setup: { enterprise_id: "ent", ruleset_ids: ["required"] } });
    expect(await setupWorkspace.run(ctx, args)).toMatchObject({
      status: "ruleset_verification_required",
      workspace: { id: "existing" },
    });
  });
});
