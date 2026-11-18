import { describe, it, expect, vi } from "vitest";
import { mockClient, mockContext } from "../test-helpers.js";
import {
  listComplianceFindings,
  TRUNCATED_NOTE,
  UNCOVERED_NEXT,
} from "./list_compliance_findings.js";
import { FINDINGS_DEFAULT_LIMIT } from "./validation.js";

const ctxWith = (findings: unknown[]) =>
  mockContext({
    client: mockClient({ listComplianceFindings: vi.fn().mockResolvedValue({ findings }) }),
    getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
  });

const failing = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ rule_id: `r${i}`, status: "fail", exception: null }));

type Result = {
  findings: Array<Record<string, unknown>>;
  findings_total?: number;
  truncated?: boolean;
  detail?: string;
  next?: string;
};

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

    const result = (await listComplianceFindings.run(ctx, { workspace_id: "ws_1" })) as Result;

    expect(result.next).toBe(UNCOVERED_NEXT(2));
    expect(result.findings_total).toBe(6);
    expect(result).not.toHaveProperty("truncated");
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

  it("passes status and ruleset_id through to the API", async () => {
    const ctx = ctxWith([]);

    await listComplianceFindings.run(ctx, {
      workspace_id: "ws_1",
      ref: "eval_1",
      status: "fail",
      ruleset_id: "rs_1",
    });

    expect(ctx.client.listComplianceFindings).toHaveBeenCalledWith("ent_1", "ws_1", {
      ref: "eval_1",
      status: "fail",
      ruleset_id: "rs_1",
    });
  });

  it("cuts the list at the default limit and says how many there were", async () => {
    const ctx = ctxWith(failing(FINDINGS_DEFAULT_LIMIT + 5));

    const result = (await listComplianceFindings.run(ctx, { workspace_id: "ws_1" })) as Result;

    expect(result.findings).toHaveLength(FINDINGS_DEFAULT_LIMIT);
    expect(result.findings_total).toBe(FINDINGS_DEFAULT_LIMIT + 5);
    expect(result.truncated).toBe(true);
    expect(result.next).toBe(
      TRUNCATED_NOTE(FINDINGS_DEFAULT_LIMIT, FINDINGS_DEFAULT_LIMIT + 5) +
        UNCOVERED_NEXT(FINDINGS_DEFAULT_LIMIT + 5)
    );
  });

  it("honours an explicit limit and counts uncovered failures beyond it", async () => {
    const ctx = ctxWith([
      { rule_id: "a", status: "pass", exception: null },
      { rule_id: "b", status: "fail", exception: null },
      { rule_id: "c", status: "fail", exception: null },
    ]);

    const result = (await listComplianceFindings.run(ctx, {
      workspace_id: "ws_1",
      limit: 1,
    })) as Result;

    expect(result.findings.map((f) => f.rule_id)).toEqual(["a"]);
    expect(result.truncated).toBe(true);
    expect(result.next).toBe(TRUNCATED_NOTE(1, 3) + UNCOVERED_NEXT(2));
  });

  it("drops the long text fields in summary detail and keeps the rest", async () => {
    const ctx = ctxWith([
      {
        rule_id: "a",
        rule_title: "No public buckets",
        status: "fail",
        justification: "long audit text",
        evidence: { file: "main.tf", line: 3 },
        delta_justification: "moved",
        exception: null,
      },
    ]);

    const result = (await listComplianceFindings.run(ctx, {
      workspace_id: "ws_1",
      detail: "summary",
    })) as Result;

    expect(result.detail).toBe("summary");
    expect(result.findings[0]).toEqual({
      rule_id: "a",
      rule_title: "No public buckets",
      status: "fail",
      exception: null,
    });
  });

  it("returns full findings by default", async () => {
    const ctx = ctxWith([{ rule_id: "a", status: "pass", justification: "kept", exception: null }]);

    const result = (await listComplianceFindings.run(ctx, { workspace_id: "ws_1" })) as Result;

    expect(result.findings[0].justification).toBe("kept");
    expect(result).not.toHaveProperty("detail");
  });

  it("leaves a response without a findings array alone", async () => {
    const ctx = mockContext({
      client: mockClient({ listComplianceFindings: vi.fn().mockResolvedValue({ found: false }) }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
    });

    expect(await listComplianceFindings.run(ctx, { workspace_id: "ws_1" })).toEqual({
      found: false,
    });
  });
});
