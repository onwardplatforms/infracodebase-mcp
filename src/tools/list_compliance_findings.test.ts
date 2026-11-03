import { describe, it, expect, vi } from "vitest";
import { mockClient, mockContext } from "../test-helpers.js";
import { listComplianceFindings, UNCOVERED_NEXT } from "./list_compliance_findings.js";

const ctxWith = (findings: unknown[]) =>
  mockContext({
    client: mockClient({ listComplianceFindings: vi.fn().mockResolvedValue({ findings }) }),
    getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
  });

describe("list_compliance_findings", () => {
  it("counts failures with no exception or a stale one, but not pending or active ones", async () => {
    const ctx = ctxWith([
      { rule_id: "a", status: "fail", exception: null },
      { rule_id: "b", status: "fail", exception: { state: "stale", pending_request: null } },
      {
        rule_id: "b2",
        status: "fail",
        exception: { state: "stale", pending_request: { type: "risk_acceptance" } },
      },
      { rule_id: "c", status: "fail", exception: { state: "pending" } },
      { rule_id: "d", status: "fail", exception: { state: "active" } },
      { rule_id: "e", status: "pass", exception: null },
    ]);

    const result = (await listComplianceFindings.run(ctx, { workspace_id: "ws_1" })) as {
      next?: string;
    };

    expect(result.next).toBe(UNCOVERED_NEXT(2));
  });

  it("adds nothing when every failure is covered, or the server predates the annotation", async () => {
    const covered = ctxWith([{ rule_id: "a", status: "fail", exception: { state: "active" } }]);
    const older = ctxWith([{ rule_id: "a", status: "fail" }]);

    expect(await listComplianceFindings.run(covered, { workspace_id: "ws_1" })).not.toHaveProperty(
      "next"
    );
    expect(await listComplianceFindings.run(older, { workspace_id: "ws_1" })).not.toHaveProperty(
      "next"
    );
  });
});
