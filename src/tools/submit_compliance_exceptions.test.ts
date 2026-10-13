import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../client.js";
import { mockClient, mockContext } from "../test-helpers.js";
import {
  submitComplianceExceptions,
  REQUESTED_NEXT,
  GRANTED_NEXT,
  FAILED_NEXT,
} from "./submit_compliance_exceptions.js";

const ctxWith = (methods: Parameters<typeof mockClient>[0]) =>
  mockContext({
    client: mockClient(methods),
    getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
  });

const apiError = (status: number, code: string) =>
  new ApiError(status, JSON.stringify({ type: "permission_error", code, message: code }), "/x");

const leftovers = [
  { rule_id: "lt_1", type: "not_applicable", justification: "Defender is enabled per subscription." },
  { rule_id: "im_7", type: "not_applicable", justification: "Conditional access is a tenant setting." },
  { rule_id: "ns_1", type: "not_applicable", justification: "NSGs belong to the network team." },
];

const pending = (rule_id: string) => ({ rule_id, rule_title: rule_id, state: "pending", request_number: 1 });

type Result = {
  requested: unknown[];
  granted: unknown[];
  failed: Array<{ rule_id: string; code?: string }>;
  stopped?: { code?: string };
  not_attempted?: string[];
  next: string;
};

describe("submit_compliance_exceptions", () => {
  it("requests review by default, one call per rule", async () => {
    const submit = vi.fn(async (_e: string, _w: string, body: { rule_id: string }) =>
      pending(body.rule_id)
    );
    const ctx = ctxWith({ submitComplianceException: submit });

    const result = (await submitComplianceExceptions.run(ctx, {
      workspace_id: "ws_1",
      exceptions: leftovers.slice(0, 2),
    })) as Result;

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
    })) as Result;

    expect(submit.mock.calls[0][2]).toMatchObject({ mode: "grant" });
    expect(result.granted).toHaveLength(1);
    expect(result.next).toBe(GRANTED_NEXT);
  });

  it("keeps going past a rule-specific failure and reports its code", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, "rule_not_overridable"))
      .mockResolvedValueOnce(pending("im_7"));
    const ctx = ctxWith({ submitComplianceException: submit });

    const result = (await submitComplianceExceptions.run(ctx, {
      workspace_id: "ws_1",
      exceptions: leftovers.slice(0, 2),
    })) as Result;

    expect(result.requested).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ rule_id: "lt_1", code: "rule_not_overridable" }),
    ]);
    expect(result.next).toBe(`${REQUESTED_NEXT} ${FAILED_NEXT}`);
  });

  it("fails the call outright when a caller-level error hits before anything succeeds", async () => {
    const submit = vi.fn().mockRejectedValue(apiError(403, "user_context_required"));
    const ctx = ctxWith({ submitComplianceException: submit });

    await expect(
      submitComplianceExceptions.run(ctx, { workspace_id: "ws_1", exceptions: leftovers })
    ).rejects.toBeInstanceOf(ApiError);
    // One call, not one per rule.
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("stops mid-batch on a caller-level error, keeping what went through", async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce(pending("lt_1"))
      .mockRejectedValueOnce(apiError(401, "unauthorized"));
    const ctx = ctxWith({ submitComplianceException: submit });

    const result = (await submitComplianceExceptions.run(ctx, {
      workspace_id: "ws_1",
      exceptions: leftovers,
    })) as Result;

    expect(submit).toHaveBeenCalledTimes(2);
    expect(result.requested).toHaveLength(1);
    expect(result.stopped).toMatchObject({ code: "unauthorized" });
    expect(result.not_attempted).toEqual(["im_7", "ns_1"]);
    expect(result.next).toContain(REQUESTED_NEXT);
    expect(result.next).toContain("not_attempted");
  });

  it("keeps earlier rule failures when a caller-level error stops the batch", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(apiError(404, "rule_not_found"))
      .mockRejectedValueOnce(apiError(401, "unauthorized"));
    const ctx = ctxWith({ submitComplianceException: submit });

    const result = (await submitComplianceExceptions.run(ctx, {
      workspace_id: "ws_1",
      exceptions: leftovers,
    })) as Result;

    expect(result.failed).toEqual([expect.objectContaining({ rule_id: "lt_1", code: "rule_not_found" })]);
    expect(result.stopped).toMatchObject({ code: "unauthorized" });
    expect(result.not_attempted).toEqual(["im_7", "ns_1"]);
  });

  it("offers to request instead when a grant is refused", async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ rule_id: "lt_1", rule_title: "x", state: "active", request_number: null })
      .mockRejectedValueOnce(apiError(403, "cannot_approve_compliance"));
    const ctx = ctxWith({ submitComplianceException: submit });

    const result = (await submitComplianceExceptions.run(ctx, {
      workspace_id: "ws_1",
      exceptions: leftovers,
      grant: true,
    })) as Result;

    expect(result.not_attempted).toEqual(["im_7", "ns_1"]);
    expect(result.next).toContain("submit the same exceptions as requests");
  });
});
