import { describe, it, expect, vi } from "vitest";
import { getWorkspaceContext } from "./get_workspace_context.js";
import { mockClient, mockContext } from "../test-helpers.js";

const NO_BRANCH = { branch_detection: "no_checkout", branch_note: expect.any(String) };

describe("get_workspace_context", () => {
  it("resolves by workspace_id via a single client call, without touching repo detection", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({ client });

    await getWorkspaceContext.run(ctx, { workspace_id: "ws_1", iac_tool: "terraform" });

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith({
      repoUrl: undefined,
      workspaceId: "ws_1",
      iacTool: "terraform",
      branch: undefined,
    });
    expect(ctx.resolveRepoUrl).not.toHaveBeenCalled();
  });

  it("resolves by repo_url via the same single client call", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({ client });

    await getWorkspaceContext.run(ctx, { repo_url: "owner/name" });

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith({
      repoUrl: "owner/name",
      workspaceId: undefined,
      iacTool: undefined,
      branch: undefined,
    });
  });

  it("returns the client's response verbatim for a linked workspace, including nested fields", async () => {
    const linkedResponse = {
      status: "linked",
      workspace: { id: "ws_1", name: "Infra", repo: { owner: "acme", name: "infra" } },
      rulesets: [{ id: "rs_1", title: "Security" }],
      coding_guidelines: "Use least privilege.",
      compliance: { score: 92 },
      modules: { status: "ok", count: 3 },
    };
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(linkedResponse),
    });
    const ctx = mockContext({ client });

    const result = await getWorkspaceContext.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({ ...linkedResponse, ...NO_BRANCH });
  });

  it.each(["unlinked", "no_access", "ambiguous"] as const)(
    "passes through a %s response verbatim, including its message field",
    async (status) => {
      const response = { status, owner: "owner", name: "name", message: `explanation for ${status}` };
      const client = mockClient({
        resolveWorkspaceContext: vi.fn().mockResolvedValue(response),
      });
      const ctx = mockContext({ client });

      const result = await getWorkspaceContext.run(ctx, { repo_url: "owner/name" });

      expect(result).toEqual({ ...response, ...NO_BRANCH });
    }
  );

  it("auto-detects the repo when called with no arguments and says where it came from", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" }),
    });
    const ctx = mockContext({
      client,
      resolveRepoUrl: vi.fn(async () => ({
        repo_url: "https://github.com/acme/infra.git",
        resolved_from: "cwd" as const,
      })),
    });

    const result = await getWorkspaceContext.run(ctx, {});

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith({
      repoUrl: "https://github.com/acme/infra.git",
      workspaceId: undefined,
      iacTool: undefined,
    });
    expect(result).toEqual({
      ...NO_BRANCH,
      status: "unlinked",
      owner: "acme",
      name: "infra",
      resolved_repo_url: "https://github.com/acme/infra.git",
      resolved_from: "cwd",
    });
  });

  it("surfaces the detector's error when no repo can be found and nothing was passed", async () => {
    const client = mockClient({ resolveWorkspaceContext: vi.fn() });
    const ctx = mockContext({ client });

    await expect(getWorkspaceContext.run(ctx, {})).rejects.toThrow(/Could not detect a git remote/);
    expect(client.resolveWorkspaceContext).not.toHaveBeenCalled();
  });

  it("sends the detected branch with an auto-detected repo and reports it", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({
      client,
      resolveRepoUrl: vi.fn(async () => ({
        repo_url: "https://github.com/acme/infra",
        resolved_from: "cwd" as const,
        branch: "feature/x",
      })),
    });

    const result = await getWorkspaceContext.run(ctx, {});

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith({
      repoUrl: "https://github.com/acme/infra",
      workspaceId: undefined,
      iacTool: undefined,
      branch: "feature/x",
    });
    expect(result).toEqual({
      status: "linked",
      resolved_repo_url: "https://github.com/acme/infra",
      resolved_from: "cwd",
      resolved_branch: "feature/x",
      branch_resolved_from: "cwd",
    });
  });

  it("lets an explicit branch override detection, with workspace_id or an auto-detected repo", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({
      client,
      resolveRepoUrl: vi.fn(async () => ({
        repo_url: "https://github.com/acme/infra",
        resolved_from: "roots" as const,
        branch: "feature/detected",
      })),
    });

    await getWorkspaceContext.run(ctx, { workspace_id: "ws_1", branch: "main" });
    expect(client.resolveWorkspaceContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", branch: "main" })
    );

    const result = await getWorkspaceContext.run(ctx, { branch: "release/1" });
    expect(client.resolveWorkspaceContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ repoUrl: "https://github.com/acme/infra", branch: "release/1" })
    );
    expect(result).not.toHaveProperty("resolved_branch");
  });

  it("with workspace_id, uses a checkout of that workspace's repo and says when there is none", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const getWorkspaceRepo = vi.fn(async () => ({ owner: "acme", name: "infra" }));
    const resolveBranch = vi.fn(async () => ({ branch: "feature/x", resolved_from: "cwd" as const }));
    const ctx = mockContext({ client, getWorkspaceRepo, resolveBranch });

    const result = await getWorkspaceContext.run(ctx, { workspace_id: "ws_1" });

    expect(getWorkspaceRepo).toHaveBeenCalledWith("ws_1");
    expect(resolveBranch).toHaveBeenCalledWith(undefined, { repo: { owner: "acme", name: "infra" } });
    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", branch: "feature/x" })
    );
    expect(result).toEqual({
      status: "linked",
      resolved_branch: "feature/x",
      branch_resolved_from: "cwd",
    });

    const other = mockContext({
      client,
      getWorkspaceRepo,
      resolveBranch: vi.fn(async () => ({ branch: null, reason: "other_repo" as const })),
    });
    const fallback = await getWorkspaceContext.run(other, { workspace_id: "ws_1" });
    expect(client.resolveWorkspaceContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", branch: undefined })
    );
    expect(fallback).toMatchObject({
      status: "linked",
      branch_detection: "other_repo",
      branch_note: expect.stringContaining("not this workspace's repo"),
    });
  });

  it("with an explicit repo_url, only a checkout of that repo supplies the branch", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const resolveBranch = vi.fn(async () => ({ branch: "release/1", resolved_from: "roots" as const }));
    const ctx = mockContext({ client, resolveBranch });

    const result = await getWorkspaceContext.run(ctx, { repo_url: "git@github.com:Acme/Infra.git" });

    expect(resolveBranch).toHaveBeenCalledWith(undefined, { repo: { owner: "acme", name: "infra" } });
    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith(
      expect.objectContaining({ repoUrl: "git@github.com:Acme/Infra.git", branch: "release/1" })
    );
    expect(result).toEqual({
      status: "linked",
      resolved_branch: "release/1",
      branch_resolved_from: "roots",
    });
  });
});
