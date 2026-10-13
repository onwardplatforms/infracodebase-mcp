import { describe, it, expect, vi } from "vitest";
import { mockClient, mockContext } from "../test-helpers.js";
import { revokeComplianceException } from "./revoke_compliance_exception.js";

describe("revoke_compliance_exception", () => {
  it("revokes through the API", async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const ctx = mockContext({
      client: mockClient({ revokeComplianceException: revoke }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
    });

    const result = await revokeComplianceException.run(ctx, { workspace_id: "ws_1", rule_id: "lt_1" });

    expect(revoke).toHaveBeenCalledWith("ent_1", "ws_1", "lt_1");
    expect(result).toMatchObject({ rule_id: "lt_1", state: "revoked" });
  });
});
