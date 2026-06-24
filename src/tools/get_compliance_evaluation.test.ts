import { describe, it, expect, vi } from "vitest";
import { getComplianceEvaluation } from "./get_compliance_evaluation.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_compliance_evaluation", () => {
  it("resolves the enterprise then fetches the evaluation with the given ref", async () => {
    const client = mockClient({ getComplianceEvaluation: vi.fn().mockResolvedValue({}) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1", ref: "abc123" });

    expect(client.getComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", "abc123");
  });

  it("passes an undefined ref through (latest evaluation)", async () => {
    const client = mockClient({ getComplianceEvaluation: vi.fn().mockResolvedValue({}) });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    await getComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });

    expect(client.getComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", undefined);
  });
});
