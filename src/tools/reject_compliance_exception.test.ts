import { describe, it, expect, vi } from "vitest";
import { mockClient, mockContext } from "../test-helpers.js";
import { rejectComplianceException } from "./reject_compliance_exception.js";

describe("reject_compliance_exception", () => {
  it("passes the reason through and says any exception in force is unchanged", async () => {
    const reject = vi.fn().mockResolvedValue(undefined);
    const ctx = mockContext({
      client: mockClient({ rejectComplianceException: reject }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
    });

    const result = (await rejectComplianceException.run(ctx, {
      workspace_id: "ws_1",
      rule_id: "lt_1",
      reason: "Fix it in the module.",
    })) as { next: string };

    expect(reject).toHaveBeenCalledWith("ent_1", "ws_1", "lt_1", "Fix it in the module.");
    expect(result.next).toContain("Any exception already in force on the rule is unchanged");
  });
});
