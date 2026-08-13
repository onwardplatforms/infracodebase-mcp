import { describe, it, expect, vi } from "vitest";
import { triggerComplianceEvaluation } from "./trigger_compliance_evaluation.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("trigger_compliance_evaluation", () => {
  it("resolves the enterprise and triggers a full evaluation with no scoping args", async () => {
    const client = mockClient({
      triggerComplianceEvaluation: vi.fn().mockResolvedValue({ id: "eval_1", status: "running" }),
    });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await triggerComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.triggerComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", {
      ref: undefined,
      ruleset_id: undefined,
      rule_id: undefined,
      rule_ids: undefined,
    });
  });

  it("passes ruleset_id/rule_id through to scope a partial run", async () => {
    const client = mockClient({ triggerComplianceEvaluation: vi.fn().mockResolvedValue({}) });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    await triggerComplianceEvaluation.run(ctx, {
      workspace_id: "ws_1",
      ref: "feature/x",
      ruleset_id: "rs_1",
      rule_id: "rule_1",
    });

    expect(client.triggerComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", {
      ref: "feature/x",
      ruleset_id: "rs_1",
      rule_id: "rule_1",
      rule_ids: undefined,
    });
  });

  it("passes rule_ids through to scope a batch re-check", async () => {
    const client = mockClient({ triggerComplianceEvaluation: vi.fn().mockResolvedValue({}) });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    await triggerComplianceEvaluation.run(ctx, {
      workspace_id: "ws_1",
      rule_ids: ["rule_2", "rule_3"],
    });

    expect(client.triggerComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", {
      ref: undefined,
      ruleset_id: undefined,
      rule_id: undefined,
      rule_ids: ["rule_2", "rule_3"],
    });
  });

  // Regression test: rule_id and rule_ids were documented as "mutually
  // exclusive" but nothing enforced it — both together were silently
  // forwarded to the server with undefined behavior. Now rejected before
  // ever reaching the client.
  it("rejects rule_id and rule_ids given together", async () => {
    const client = mockClient({ triggerComplianceEvaluation: vi.fn() });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    await expect(
      triggerComplianceEvaluation.run(ctx, {
        workspace_id: "ws_1",
        rule_id: "rule_1",
        rule_ids: ["rule_2"],
      })
    ).rejects.toThrow("Pass either rule_id or rule_ids, not both.");
    expect(client.triggerComplianceEvaluation).not.toHaveBeenCalled();
  });

  it("passes an enterprise_id hint through to resolution", async () => {
    const client = mockClient({ triggerComplianceEvaluation: vi.fn().mockResolvedValue({}) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_9");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await triggerComplianceEvaluation.run(ctx, { workspace_id: "ws_1", enterprise_id: "ent_9" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", "ent_9");
  });

  it("returns the client's response verbatim, including the results-page url", async () => {
    const client = mockClient({
      triggerComplianceEvaluation: vi.fn().mockResolvedValue({
        id: "eval_1",
        status: "running",
        url: "https://app.infracodebase.com/acme/my-workspace/compliance/eval_1",
      }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await triggerComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({
      id: "eval_1",
      status: "running",
      url: "https://app.infracodebase.com/acme/my-workspace/compliance/eval_1",
    });
  });
});
