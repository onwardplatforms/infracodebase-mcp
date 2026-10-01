import { describe, it, expect, vi } from "vitest";
import { getComplianceEvaluation, RUNNING_NEXT } from "./get_compliance_evaluation.js";
import { mockClient, mockContext } from "../test-helpers.js";

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

    expect(result).toEqual({ id: "eval_1", status: "running", url: "https://x", next: RUNNING_NEXT });
  });

  it("leaves a completed evaluation untouched", async () => {
    const client = mockClient({
      getComplianceEvaluation: vi.fn().mockResolvedValue({ id: "eval_1", status: "completed", score: 88 }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({ id: "eval_1", status: "completed", score: 88 });
    expect(result).not.toHaveProperty("next");
  });
});
