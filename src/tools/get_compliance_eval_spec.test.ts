import { describe, it, expect, vi } from "vitest";
import { getComplianceEvalSpec } from "./get_compliance_eval_spec.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_compliance_eval_spec", () => {
  it("resolves the enterprise then fetches the eval spec", async () => {
    const client = mockClient({ getComplianceEvalSpec: vi.fn().mockResolvedValue({}) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await getComplianceEvalSpec.run(ctx, { workspace_id: "ws_1" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.getComplianceEvalSpec).toHaveBeenCalledWith("ent_1", "ws_1");
  });
});
