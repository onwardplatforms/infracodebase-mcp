import { describe, it, expect, vi } from "vitest";
import { getComplianceEvaluation, RUNNING_NEXT } from "./get_compliance_evaluation.js";
import { mockClient, mockContext } from "../test-helpers.js";
import { ApiError } from "../client.js";

const NO_BRANCH = { branch_detection: "no_checkout", branch_note: expect.any(String) };

describe("get_compliance_evaluation", () => {
  it("resolves the enterprise and fetches the latest evaluation with no ref/branch", async () => {
    const client = mockClient({ getComplianceEvaluation: vi.fn().mockResolvedValue({ score: 90 }) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.getComplianceEvaluation).toHaveBeenCalledWith(
      "ent_1",
      "ws_1",
      undefined,
      undefined
    );
  });

  it("passes branch through to scope 'latest' to the current branch", async () => {
    const client = mockClient({ getComplianceEvaluation: vi.fn().mockResolvedValue({}) });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1", branch: "feature/x" });

    expect(client.getComplianceEvaluation).toHaveBeenCalledWith(
      "ent_1",
      "ws_1",
      undefined,
      "feature/x"
    );
  });

  it("passes ref through unchanged", async () => {
    const client = mockClient({ getComplianceEvaluation: vi.fn().mockResolvedValue({}) });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1", ref: "abc123" });

    expect(client.getComplianceEvaluation).toHaveBeenCalledWith(
      "ent_1",
      "ws_1",
      "abc123",
      undefined
    );
  });

  it("returns the client's response verbatim, including the results-page url", async () => {
    const client = mockClient({
      getComplianceEvaluation: vi.fn().mockResolvedValue({
        score: 90,
        url: "https://app.infracodebase.com/acme/my-workspace/compliance/eval_1",
      }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({
      ...NO_BRANCH,
      score: 90,
      url: "https://app.infracodebase.com/acme/my-workspace/compliance/eval_1",
    });
  });
});

describe("get_compliance_evaluation — in-flight runs", () => {
  it("attaches a `next` instruction while the evaluation is still running", async () => {
    const client = mockClient({
      getComplianceEvaluation: vi.fn().mockResolvedValue({ id: "eval_1", status: "running", url: "https://x" }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({
      ...NO_BRANCH,
      id: "eval_1",
      status: "running",
      url: "https://x",
      next: RUNNING_NEXT,
    });
  });

  it("leaves a completed evaluation untouched", async () => {
    const client = mockClient({
      getComplianceEvaluation: vi.fn().mockResolvedValue({ id: "eval_1", status: "completed", score: 88 }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({ ...NO_BRANCH, id: "eval_1", status: "completed", score: 88 });
    expect(result).not.toHaveProperty("next");
  });

  it("scopes 'latest' to the checked-out branch when no ref or branch is given, and reports it", async () => {
    const client = mockClient({ getComplianceEvaluation: vi.fn().mockResolvedValue({ score: 56 }) });
    const ctx = mockContext({
      client,
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
      resolveBranch: vi.fn(async () => ({ branch: "feature/cwd", resolved_from: "cwd" as const })),
    });

    const result = await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(client.getComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", undefined, "feature/cwd");
    expect(result).toEqual({ score: 56, resolved_branch: "feature/cwd", branch_resolved_from: "cwd" });
  });

  it("never detects a branch for a ref lookup", async () => {
    const client = mockClient({ getComplianceEvaluation: vi.fn().mockResolvedValue({ score: 1 }) });
    const resolveBranch = vi.fn(async () => ({ branch: "feature/cwd", resolved_from: "cwd" as const }));
    const ctx = mockContext({
      client,
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
      resolveBranch,
    });

    const result = await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1", ref: "abc123" });

    expect(resolveBranch).not.toHaveBeenCalled();
    expect(client.getComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", "abc123", undefined);
    expect(result).toEqual({ score: 1 });
  });

  it("turns the API's 404 on a detected branch into a structured found: false that names the branch", async () => {
    const client = mockClient({
      getComplianceEvaluation: vi.fn().mockRejectedValue(
        new ApiError(
          404,
          JSON.stringify({ code: "evaluation_not_found", message: "No compliance evaluation found for this workspace." }),
          "/x"
        )
      ),
    });
    const ctx = mockContext({
      client,
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
      getWorkspaceRepo: vi.fn(async () => ({ owner: "acme", name: "infra" })),
      resolveBranch: vi.fn(async () => ({ branch: "feature/new", resolved_from: "cwd" as const })),
    });

    const result = await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(result).toMatchObject({
      found: false,
      branch: "feature/new",
      resolved_branch: "feature/new",
      branch_resolved_from: "cwd",
      message: expect.stringContaining("No completed compliance evaluation is visible on feature/new"),
    });
    expect((result as { message: string }).message).not.toContain("for this workspace");
  });

  it("still throws a 404 that is about the workspace, not the evaluation", async () => {
    // A wrong enterprise_id hint 404s too; that must not read as an empty branch.
    const wrongWorkspace = new ApiError(
      404,
      JSON.stringify({ code: "workspace_not_found", message: "Workspace not found." }),
      "/x"
    );
    const ctx = mockContext({
      client: mockClient({ getComplianceEvaluation: vi.fn().mockRejectedValue(wrongWorkspace) }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_wrong"),
      resolveBranch: vi.fn(async () => ({ branch: "feature/new", resolved_from: "cwd" as const })),
    });

    await expect(
      getComplianceEvaluation.run(ctx, { workspace_id: "ws_1", enterprise_id: "ent_wrong" })
    ).rejects.toBe(wrongWorkspace);
  });

  it("still throws a 404 for a ref lookup and for other errors", async () => {
    const notFound = new ApiError(404, JSON.stringify({ code: "evaluation_not_found" }), "/x");
    const ctx = mockContext({
      client: mockClient({ getComplianceEvaluation: vi.fn().mockRejectedValue(notFound) }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
      resolveBranch: vi.fn(async () => ({ branch: "feature/new", resolved_from: "cwd" as const })),
    });
    await expect(getComplianceEvaluation.run(ctx, { workspace_id: "ws_1", ref: "abc" })).rejects.toBe(
      notFound
    );

    const forbidden = new ApiError(403, "forbidden", "/x");
    const denied = mockContext({
      client: mockClient({ getComplianceEvaluation: vi.fn().mockRejectedValue(forbidden) }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
      resolveBranch: vi.fn(async () => ({ branch: "feature/new", resolved_from: "cwd" as const })),
    });
    await expect(getComplianceEvaluation.run(denied, { workspace_id: "ws_1" })).rejects.toBe(forbidden);
  });

  it("asks for a checkout of the workspace's own repo and reports when only another repo is here", async () => {
    const client = mockClient({ getComplianceEvaluation: vi.fn().mockResolvedValue({ score: 90 }) });
    const getWorkspaceRepo = vi.fn(async () => ({ owner: "acme", name: "infra" }));
    const resolveBranch = vi.fn(async () => ({ branch: null, reason: "other_repo" as const }));
    const ctx = mockContext({
      client,
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
      getWorkspaceRepo,
      resolveBranch,
    });

    const result = await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(resolveBranch).toHaveBeenCalledWith(undefined, { repo: { owner: "acme", name: "infra" } });
    expect(client.getComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", undefined, undefined);
    expect(result).toMatchObject({ score: 90, branch_detection: "other_repo" });
  });
});
