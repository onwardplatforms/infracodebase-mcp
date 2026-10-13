import { describe, it, expect, vi } from "vitest";
import { mockClient, mockContext } from "../test-helpers.js";
import { approveComplianceException, APPROVED_NEXT } from "./approve_compliance_exception.js";

describe("approve_compliance_exception", () => {
  it("approves through the API and says the exception is now in force", async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const ctx = mockContext({
      client: mockClient({ approveComplianceException: approve }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
    });

    const result = await approveComplianceException.run(ctx, { workspace_id: "ws_1", rule_id: "lt_1" });

    expect(approve).toHaveBeenCalledWith("ent_1", "ws_1", "lt_1");
    expect(result).toEqual({ rule_id: "lt_1", state: "active", next: APPROVED_NEXT });
  });
});
