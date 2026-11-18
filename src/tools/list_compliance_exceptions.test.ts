import { describe, it, expect, vi } from "vitest";
import { mockClient, mockContext } from "../test-helpers.js";
import { listComplianceExceptions } from "./list_compliance_exceptions.js";

describe("list_compliance_exceptions", () => {
  it("returns the workspace's exceptions", async () => {
    const ctx = mockContext({
      client: mockClient({
        listComplianceExceptions: vi.fn().mockResolvedValue({ data: [{ rule_id: "lt_1" }] }),
      }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
    });

    expect(await listComplianceExceptions.run(ctx, { workspace_id: "ws_1" })).toEqual({
      exceptions: [{ rule_id: "lt_1" }],
    });
  });
});
