import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../client.js";
import { mockClient, mockContext } from "../test-helpers.js";
import {
  submitComplianceExceptions,
  REQUESTED_NEXT,
  GRANTED_NEXT,
  FAILED_NEXT,
} from "./submit_compliance_exceptions.js";
import { approveComplianceException, APPROVED_NEXT } from "./approve_compliance_exception.js";
import { rejectComplianceException } from "./reject_compliance_exception.js";
import { revokeComplianceException } from "./revoke_compliance_exception.js";
import { listComplianceExceptions } from "./list_compliance_exceptions.js";
import { listComplianceFindings, UNCOVERED_NEXT } from "./list_compliance_findings.js";

const ctxWith = (methods: Parameters<typeof mockClient>[0]) =>
  mockContext({
    client: mockClient(methods),
    getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
  });

const leftovers = [
  { rule_id: "lt_1", type: "not_applicable", justification: "Defender is enabled per subscription." },
  { rule_id: "im_7", type: "not_applicable", justification: "Conditional access is a tenant setting." },
];

describe("submit_compliance_exceptions", () => {
  it("requests review by default, one call per rule", async () => {
    const submit = vi.fn(async (_e: string, _w: string, body: { rule_id: string }) => ({
      rule_id: body.rule_id,
      rule_title: body.rule_id,
      state: "pending",
      request_number: 1,
    }));
    const ctx = ctxWith({ submitComplianceException: submit });

    const result = (await submitComplianceExceptions.run(ctx, {
      workspace_id: "ws_1",
      exceptions: leftovers,
    })) as { requested: unknown[]; granted: unknown[]; failed: unknown[]; next: string };

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]).toEqual([
      "ent_1",
      "ws_1",
      {
        rule_id: "lt_1",
        type: "not_applicable",
        justification: "Defender is enabled per subscription.",
        expires_in_days: undefined,
        evaluation_id: undefined,
        mode: "request",
      },
    ]);
    expect(result.requested).toHaveLength(2);
    expect(result.granted).toHaveLength(0);
    expect(result.next).toBe(REQUESTED_NEXT);
  });

  it("asks the server to grant only when grant is set, and says the result is final", async () => {
    const submit = vi.fn(async () => ({
      rule_id: "lt_1",
      rule_title: "Defender",
      state: "active",
      request_number: null,
    }));
    const ctx = ctxWith({ submitComplianceException: submit });

    const result = (await submitComplianceExceptions.run(ctx, {
      workspace_id: "ws_1",
      exceptions: [leftovers[0]],
      grant: true,
    })) as { granted: unknown[]; next: string };

    expect(submit.mock.calls[0][2]).toMatchObject({ mode: "grant" });
    expect(result.granted).toHaveLength(1);
    expect(result.next).toBe(GRANTED_NEXT);
  });

  it("keeps going past a failed rule and reports its error code", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(
          403,
          JSON.stringify({
            type: "permission_error",
            code: "rule_not_overridable",
            message: "Required rules can't be excepted.",
          }),
          "/x"
        )
      )
      .mockResolvedValueOnce({ rule_id: "im_7", rule_title: "CA", state: "pending", request_number: 2 });
    const ctx = ctxWith({ submitComplianceException: submit });

    const result = (await submitComplianceExceptions.run(ctx, {
      workspace_id: "ws_1",
      exceptions: leftovers,
    })) as {
      requested: unknown[];
      failed: Array<{ rule_id: string; code?: string }>;
      next: string;
    };

    expect(result.requested).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ rule_id: "lt_1", code: "rule_not_overridable" }),
    ]);
    expect(result.next).toBe(`${REQUESTED_NEXT} ${FAILED_NEXT}`);
  });
});

describe("exception decisions", () => {
  it("approve calls the API and says the rule is no longer enforced", async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const ctx = ctxWith({ approveComplianceException: approve });

    const result = await approveComplianceException.run(ctx, {
      workspace_id: "ws_1",
      rule_id: "lt_1",
    });

    expect(approve).toHaveBeenCalledWith("ent_1", "ws_1", "lt_1");
    expect(result).toEqual({ rule_id: "lt_1", state: "active", next: APPROVED_NEXT });
  });

  it("reject passes the reason through", async () => {
    const reject = vi.fn().mockResolvedValue(undefined);
    const ctx = ctxWith({ rejectComplianceException: reject });

    await rejectComplianceException.run(ctx, {
      workspace_id: "ws_1",
      rule_id: "lt_1",
      reason: "Fix it in the module.",
    });

    expect(reject).toHaveBeenCalledWith("ent_1", "ws_1", "lt_1", "Fix it in the module.");
  });

  it("revoke calls the API", async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const ctx = ctxWith({ revokeComplianceException: revoke });

    await revokeComplianceException.run(ctx, { workspace_id: "ws_1", rule_id: "lt_1" });

    expect(revoke).toHaveBeenCalledWith("ent_1", "ws_1", "lt_1");
  });

  it("list returns the workspace's exceptions", async () => {
    const ctx = ctxWith({
      listComplianceExceptions: vi.fn().mockResolvedValue({ data: [{ rule_id: "lt_1" }] }),
    });

    expect(await listComplianceExceptions.run(ctx, { workspace_id: "ws_1" })).toEqual({
      exceptions: [{ rule_id: "lt_1" }],
    });
  });
});

describe("list_compliance_findings", () => {
  it("points at exceptions when failures remain uncovered", async () => {
    const ctx = ctxWith({
      listComplianceFindings: vi.fn().mockResolvedValue({
        findings: [
          { rule_id: "a", status: "fail", exception: null },
          { rule_id: "b", status: "fail", exception: { state: "pending" } },
          { rule_id: "c", status: "pass", exception: null },
        ],
      }),
    });

    const result = (await listComplianceFindings.run(ctx, { workspace_id: "ws_1" })) as {
      next?: string;
    };

    expect(result.next).toBe(UNCOVERED_NEXT(1));
  });

  it("adds nothing when every failure is covered, or the server predates the annotation", async () => {
    const covered = ctxWith({
      listComplianceFindings: vi.fn().mockResolvedValue({
        findings: [{ rule_id: "a", status: "fail", exception: { state: "active" } }],
      }),
    });
    const older = ctxWith({
      listComplianceFindings: vi.fn().mockResolvedValue({
        findings: [{ rule_id: "a", status: "fail" }],
      }),
    });

    expect(await listComplianceFindings.run(covered, { workspace_id: "ws_1" })).not.toHaveProperty(
      "next"
    );
    expect(await listComplianceFindings.run(older, { workspace_id: "ws_1" })).not.toHaveProperty(
      "next"
    );
  });
});
