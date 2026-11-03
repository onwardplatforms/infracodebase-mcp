import { describe, it, expect, vi } from "vitest";
import {
  DRAFT_MESSAGE,
  NEEDS_ENTERPRISE_MESSAGE,
  SELECTION_MESSAGE,
  SETUP_OFFER,
  getWorkspaceContext,
} from "./get_workspace_context.js";
import { mockClient, mockContext } from "../test-helpers.js";
import { WrongEnterpriseError } from "./helpers.js";
import { ApiError } from "../client.js";

const NO_BRANCH = { branch_detection: "no_checkout", branch_note: expect.any(String) };

/** What a self-hosted server without the build-context endpoint answers. */
const NOT_FOUND = new ApiError(404, "", "/build-context", "https://api.example.com");

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

  it.each(["no_access", "ambiguous"] as const)(
    "passes through a %s response verbatim, including its message field",
    async (status) => {
      const response = { status, owner: "owner", name: "name", message: `explanation for ${status}` };
      const client = mockClient({
        resolveWorkspaceContext: vi.fn().mockResolvedValue(response),
      });
      const ctx = mockContext({ client });

      const result = await getWorkspaceContext.run(ctx, { repo_url: "owner/name" });

      // No workspace answered, so there is no branch to report on.
      expect(result).toEqual(response);
      expect(client.getBuildContext).not.toHaveBeenCalled();
    }
  );

  it("passes an unlinked response through unchanged when the server predates build-context", async () => {
    const response = { status: "unlinked", owner: "owner", name: "name", message: "set it up" };
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(response),
      getBuildContext: vi.fn().mockRejectedValue(NOT_FOUND),
    });
    const ctx = mockContext({ client });

    const result = await getWorkspaceContext.run(ctx, { repo_url: "owner/name" });

    expect(result).toEqual(response);
  });

  it("auto-detects the repo when called with no arguments and says where it came from", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" }),
      getBuildContext: vi.fn().mockRejectedValue(NOT_FOUND),
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

    expect(getWorkspaceRepo.mock.calls[0][0]).toBe("ws_1");
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

    expect(resolveBranch).toHaveBeenCalledWith(undefined, {
      repo: { owner: "Acme", name: "Infra", host: "github.com", display_path: "Acme/Infra" },
    });
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

describe("get_workspace_context — branch report scope", () => {
  it("hands the enterprise hint to the repo lookup so it stays a single request", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const getWorkspaceRepo = vi.fn(async () => ({ owner: "acme", name: "infra" }));
    const ctx = mockContext({ client, getWorkspaceRepo });

    await getWorkspaceContext.run(ctx, { workspace_id: "ws_1", enterprise_id: "ent_1" });

    expect(getWorkspaceRepo).toHaveBeenCalledWith("ws_1", "ent_1");
  });

  it("never asks the repo lookup when the branch is given", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const getWorkspaceRepo = vi.fn(async () => null);
    const ctx = mockContext({ client, getWorkspaceRepo });

    await getWorkspaceContext.run(ctx, { workspace_id: "ws_1", branch: "main" });

    expect(getWorkspaceRepo).not.toHaveBeenCalled();
    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", branch: "main" })
    );
  });

  it("keeps branch fields off a no_access answer for a workspace_id", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "no_access", message: "ask an admin" }),
    });
    const ctx = mockContext({
      client,
      resolveBranch: vi.fn(async () => ({ branch: null, reason: "other_repo" as const })),
    });

    const result = await getWorkspaceContext.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({ status: "no_access", message: "ask an admin" });
  });

  it("says when the workspace's repo is unknown instead of trusting any checkout", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({
      client,
      resolveBranch: vi.fn(async () => ({ branch: null, reason: "repo_unknown" as const })),
    });

    const result = await getWorkspaceContext.run(ctx, { workspace_id: "ws_1" });

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", branch: undefined })
    );
    expect(result).toMatchObject({
      status: "linked",
      branch_detection: "repo_unknown",
      branch_note: expect.stringContaining("Pass enterprise_id"),
    });
  });

  it("degrades to repo_unknown with the cause when the repo lookup fails, and still answers", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({
      client,
      getWorkspaceRepo: vi.fn().mockRejectedValue(new Error("API request failed: 429 /x")),
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getWorkspaceContext.run(ctx, { workspace_id: "ws_1" });

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", branch: undefined })
    );
    expect(result).toMatchObject({
      status: "linked",
      branch_detection: "repo_unknown",
      branch_note: expect.stringContaining("Detection stopped on: API request failed: 429 /x"),
    });
    quiet.mockRestore();
  });

  it("lets a wrong enterprise_id fail the call with the fix, since its own request would 404 too", async () => {
    const wrong = new WrongEnterpriseError("ws_1", "ent_wrong", "ent_1");
    const client = mockClient({ resolveWorkspaceContext: vi.fn() });
    const ctx = mockContext({ client, getWorkspaceRepo: vi.fn().mockRejectedValue(wrong) });

    await expect(
      getWorkspaceContext.run(ctx, { workspace_id: "ws_1", enterprise_id: "ent_wrong" })
    ).rejects.toBe(wrong);
    expect(client.resolveWorkspaceContext).not.toHaveBeenCalled();
  });

  it("says when an explicit repo_url cannot be parsed instead of claiming the workspace has no repo", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const resolveBranch = vi.fn();
    const ctx = mockContext({ client, resolveBranch });

    const result = await getWorkspaceContext.run(ctx, { repo_url: "not a remote" });

    expect(resolveBranch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "linked",
      branch_detection: "unparsed_repo_url",
      branch_note: expect.stringContaining("git remote get-url origin"),
    });
  });
});

describe("get_workspace_context — drafting context for an unlinked repo", () => {
  const UNLINKED = { status: "unlinked", owner: "acme", name: "infra", message: "set it up" };

  /** A complete build-context answer: required rules in, optional ones chosen. */
  const DRAFTING = {
    status: "unlinked",
    can_generate: true,
    selection_required: false,
    setup: { enterprise_id: "ent_1", ruleset_ids: ["rs_req"] },
    context_scope: "enterprise",
    enterprise: { id: "ent_1", name: "Acme" },
    workspace: null,
    coding_guidelines: { iac_tool: "terraform", content: "Use least privilege." },
    rulesets: [{ id: "rs_req", title: "Security", required: true, rules: [] }],
    available_rulesets: [],
    modules: { status: "ok", entries: [], message: "none" },
    compliance: { latest_evaluation: null },
    message: "api drafting message",
  };

  it("merges the enterprise drafting context into an unlinked answer and says setup is an offer", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(UNLINKED),
      getBuildContext: vi.fn().mockResolvedValue(DRAFTING),
    });
    const ctx = mockContext({ client });

    const result = await getWorkspaceContext.run(ctx, {
      repo_url: "acme/infra",
      iac_tool: "terraform",
      enterprise_id: "ent_1",
      ruleset_ids: ["rs_opt"],
    });

    expect(client.getBuildContext).toHaveBeenCalledWith({
      repoUrl: "acme/infra",
      enterpriseId: "ent_1",
      rulesetIds: ["rs_opt"],
      iacTool: "terraform",
      branch: undefined,
    });
    expect(result).toEqual({
      ...UNLINKED,
      ...DRAFTING,
      message: `${DRAFT_MESSAGE} ${SETUP_OFFER}`,
    });
  });

  it("keeps the auto-detected repo and branch on the merged answer", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(UNLINKED),
      getBuildContext: vi.fn().mockResolvedValue(DRAFTING),
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

    expect(client.getBuildContext).toHaveBeenCalledWith(
      expect.objectContaining({ repoUrl: "https://github.com/acme/infra", branch: "feature/x" })
    );
    expect(result).toMatchObject({
      status: "unlinked",
      can_generate: true,
      resolved_repo_url: "https://github.com/acme/infra",
      resolved_from: "cwd",
    });
    // Nothing is linked, so there is no branch scope to report.
    expect(result).not.toHaveProperty("branch_detection");
  });

  it("asks for a ruleset selection, naming this server's tool, when the API wants one", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(UNLINKED),
      getBuildContext: vi.fn().mockResolvedValue({
        ...DRAFTING,
        can_generate: false,
        selection_required: true,
        available_rulesets: [{ id: "rs_opt", title: "Tagging", rule_titles: ["Tag everything"] }],
        message: "Call get_rules with ...",
      }),
    });

    const result = await getWorkspaceContext.run(mockContext({ client }), { repo_url: "acme/infra" });

    expect(result).toMatchObject({
      status: "unlinked",
      can_generate: false,
      selection_required: true,
      message: `${SELECTION_MESSAGE} ${SETUP_OFFER}`,
    });
    expect((result as { message: string }).message).not.toContain("get_rules ");
  });

  it("keeps the API's reason when drafting is blocked for another cause, like a module catalog outage", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(UNLINKED),
      getBuildContext: vi.fn().mockResolvedValue({
        ...DRAFTING,
        can_generate: false,
        modules: { status: "unavailable", entries: [], message: "catalog down" },
        message: "The module catalog could not be checked. Retry context lookup.",
      }),
    });

    const result = await getWorkspaceContext.run(mockContext({ client }), { repo_url: "acme/infra" });

    expect(result).toMatchObject({
      can_generate: false,
      message: `The module catalog could not be checked. Retry context lookup. ${SETUP_OFFER}`,
    });
  });

  it("passes needs_enterprise through with the enterprises to choose from", async () => {
    const enterprises = [
      { id: "ent_1", name: "Acme" },
      { id: "ent_2", name: "Globex" },
    ];
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(UNLINKED),
      getBuildContext: vi.fn().mockResolvedValue({
        status: "needs_enterprise",
        can_generate: false,
        enterprises,
        message: "Which enterprise are you building for? Call get_workspace_context with its enterprise_id.",
      }),
    });

    const result = await getWorkspaceContext.run(mockContext({ client }), { repo_url: "acme/infra" });

    expect(result).toEqual({
      ...UNLINKED,
      status: "needs_enterprise",
      can_generate: false,
      enterprises,
      message: NEEDS_ENTERPRISE_MESSAGE,
    });
  });

  it("keeps the unlinked answer, with can_generate false, when no enterprise is accessible", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(UNLINKED),
      getBuildContext: vi.fn().mockResolvedValue({
        status: "no_access",
        can_generate: false,
        enterprises: [],
        message: "No enterprise is accessible.",
      }),
    });

    const result = await getWorkspaceContext.run(mockContext({ client }), { repo_url: "acme/infra" });

    expect(result).toEqual({
      ...UNLINKED,
      can_generate: false,
      message: "set it up No enterprise is accessible.",
    });
  });

  it("lets a build-context failure other than 404 reach the agent, since it names the fix", async () => {
    const forbidden = new ApiError(
      403,
      JSON.stringify({ message: "You do not have access to the selected enterprise." }),
      "/build-context",
      "https://api.example.com"
    );
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(UNLINKED),
      getBuildContext: vi.fn().mockRejectedValue(forbidden),
    });

    await expect(
      getWorkspaceContext.run(mockContext({ client }), { repo_url: "acme/infra", enterprise_id: "ent_x" })
    ).rejects.toBe(forbidden);
  });

  it("never consults build-context for a linked repo", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    const result = await getWorkspaceContext.run(mockContext({ client }), { repo_url: "acme/infra" });

    expect(client.getBuildContext).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "linked" });
  });

  describe("with no git remote at all", () => {
    it("answers with the enterprise context and says why no repo was resolved", async () => {
      const client = mockClient({
        resolveWorkspaceContext: vi.fn(),
        getBuildContext: vi.fn().mockResolvedValue({ ...DRAFTING, repository: null }),
      });
      const ctx = mockContext({ client });

      const result = await getWorkspaceContext.run(ctx, { iac_tool: "terraform", enterprise_id: "ent_1" });

      expect(client.resolveWorkspaceContext).not.toHaveBeenCalled();
      expect(client.getBuildContext).toHaveBeenCalledWith({
        enterpriseId: "ent_1",
        rulesetIds: undefined,
        iacTool: "terraform",
      });
      expect(result).toEqual({
        ...DRAFTING,
        repository: null,
        message: `${DRAFT_MESSAGE} ${SETUP_OFFER}`,
        repo_detection: expect.stringContaining("Could not detect a git remote"),
      });
    });

    it("asks which enterprise to draft for when the caller belongs to several", async () => {
      const enterprises = [{ id: "ent_1" }, { id: "ent_2" }];
      const client = mockClient({
        getBuildContext: vi
          .fn()
          .mockResolvedValue({ status: "needs_enterprise", can_generate: false, enterprises, message: "?" }),
      });

      const result = await getWorkspaceContext.run(mockContext({ client }), {});

      expect(result).toMatchObject({
        status: "needs_enterprise",
        enterprises,
        message: NEEDS_ENTERPRISE_MESSAGE,
        repo_detection: expect.any(String),
      });
    });

    it("still surfaces the detector's error on a server without build-context", async () => {
      const client = mockClient({
        resolveWorkspaceContext: vi.fn(),
        getBuildContext: vi.fn().mockRejectedValue(NOT_FOUND),
      });

      await expect(getWorkspaceContext.run(mockContext({ client }), {})).rejects.toThrow(
        /Could not detect a git remote/
      );
      expect(client.resolveWorkspaceContext).not.toHaveBeenCalled();
    });
  });
});
