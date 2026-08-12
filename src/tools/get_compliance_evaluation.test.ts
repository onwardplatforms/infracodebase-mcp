import { describe, it, expect, vi } from "vitest";
import { getComplianceEvaluation } from "./get_compliance_evaluation.js";
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
});
