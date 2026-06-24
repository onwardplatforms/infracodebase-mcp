import { describe, it, expect, vi } from "vitest";
import { listComplianceFindings } from "./list_compliance_findings.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_compliance_findings", () => {
  it("resolves the enterprise then forwards ref and status filters", async () => {
    const client = mockClient({ listComplianceFindings: vi.fn().mockResolvedValue({ data: [] }) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await listComplianceFindings.run(ctx, {
      workspace_id: "ws_1",
      ref: "abc123",
      status: "fail",
    });

    expect(client.listComplianceFindings).toHaveBeenCalledWith("ent_1", "ws_1", {
      ref: "abc123",
      status: "fail",
    });
  });
});
