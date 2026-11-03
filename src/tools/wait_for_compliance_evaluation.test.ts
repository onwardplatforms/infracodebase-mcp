import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  waitForComplianceEvaluation,
  COMPLETED_NEXT,
  FAILED_NEXT,
  CAP_NEXT,
  CANCELLED_NEXT,
  DEFAULT_POLL_INTERVAL_MS,
} from "./wait_for_compliance_evaluation.js";
import { RUNNING_NEXT } from "./get_compliance_evaluation.js";
import { mockClient, mockContext } from "../test-helpers.js";
import type { ToolExtra } from "./helpers.js";
import { ApiError } from "../client.js";

const URL = "https://app.infracodebase.com/acme/ws/compliance/eval_1";
const running = { id: "eval_1", status: "running", url: URL };
const completed = { id: "eval_1", status: "completed", result: "pass", score: 0.9, url: URL };

function extraWith(overrides: Partial<ToolExtra> = {}) {
  return {
    _meta: { progressToken: "tok_1" },
    sendNotification: vi.fn().mockResolvedValue(undefined),
    signal: new AbortController().signal,
    ...overrides,
  } as unknown as ToolExtra & { sendNotification: ReturnType<typeof vi.fn> };
}

function contextWith(...responses: unknown[]) {
  const getComplianceEvaluation = vi.fn();
  for (const r of responses) getComplianceEvaluation.mockResolvedValueOnce(r);
  // Anything past the scripted answers keeps returning the last one.
  getComplianceEvaluation.mockResolvedValue(responses[responses.length - 1]);
  const client = mockClient({ getComplianceEvaluation });
  const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });
  return { ctx, calls: getComplianceEvaluation };
}

describe("wait_for_compliance_evaluation", () => {
  // Date is faked too: the wait measures elapsed time with Date.now and the
  // cap is a deadline, so a clock that does not move would never reach it.
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("returns a finished evaluation at once without sleeping", async () => {
    const { ctx, calls } = contextWith(completed);
    const extra = extraWith();

    const result = await waitForComplianceEvaluation.run(ctx, { workspace_id: "ws_1" }, extra);

    expect(calls).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ...completed, waited_seconds: 0, next: COMPLETED_NEXT });
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it("polls by the run's id until it completes, reporting progress on each poll", async () => {
    const { ctx, calls } = contextWith(running, running, completed);
    const extra = extraWith();

    const pending = waitForComplianceEvaluation.run(ctx, { workspace_id: "ws_1" }, extra);
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS * 2);
    const result = await pending;

    expect(calls).toHaveBeenCalledTimes(3);
    // The first read is branch-scoped "latest"; every poll after it pins the id.
    expect(calls.mock.calls[0]).toEqual(["ent_1", "ws_1", undefined, undefined]);
    expect(calls.mock.calls[1]).toEqual(["ent_1", "ws_1", "eval_1", undefined]);
    expect(result).toMatchObject({ ...completed, waited_seconds: 40, next: COMPLETED_NEXT });
    expect((result as { next: string }).next).not.toBe(RUNNING_NEXT);
    expect(extra.sendNotification).toHaveBeenCalledTimes(2);
    expect(extra.sendNotification).toHaveBeenNthCalledWith(1, {
      method: "notifications/progress",
      params: { progressToken: "tok_1", progress: 1, message: expect.stringContaining("running") },
    });
  });

  it("sends no progress when the client did not ask for it", async () => {
    const { ctx } = contextWith(running, completed);
    const extra = extraWith({ _meta: {} });

    const pending = waitForComplianceEvaluation.run(ctx, { workspace_id: "ws_1" }, extra);
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS);
    await pending;

    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it("works with no extra at all, as when another tool calls it", async () => {
    const { ctx } = contextWith(running, completed);

    const pending = waitForComplianceEvaluation.run(ctx, { workspace_id: "ws_1" });
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS);

    expect(await pending).toMatchObject({ status: "completed", next: COMPLETED_NEXT });
  });

  it("returns a failed run with a next that does not suggest polling", async () => {
    const failed = { id: "eval_1", status: "failed", error_message: "runner crashed", url: URL };
    const { ctx } = contextWith(running, failed);

    const pending = waitForComplianceEvaluation.run(ctx, { workspace_id: "ws_1" }, extraWith());
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS);

    expect(await pending).toMatchObject({ ...failed, next: FAILED_NEXT });
  });

  it("gives up at max_wait_minutes and hands back the running evaluation with its url", async () => {
    const { ctx, calls } = contextWith(running);

    const pending = waitForComplianceEvaluation.run(
      ctx,
      { workspace_id: "ws_1", max_wait_minutes: 1 },
      extraWith()
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    // One initial read plus a poll at 20s, 40s, and 60s.
    expect(calls).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ ...running, waited_seconds: 60, next: CAP_NEXT });
  });

  it("never waits longer than 25 minutes whatever the caller asks for", async () => {
    const { ctx, calls } = contextWith(running);

    const pending = waitForComplianceEvaluation.run(
      ctx,
      { workspace_id: "ws_1", max_wait_minutes: 999 },
      extraWith()
    );
    await vi.advanceTimersByTimeAsync(25 * 60_000);
    const result = await pending;

    expect(result).toMatchObject({ waited_seconds: 25 * 60, next: CAP_NEXT });
    expect(calls).toHaveBeenCalledTimes(1 + 75);
  });

  it("stops when the client cancels the request and says the run continues", async () => {
    const { ctx, calls } = contextWith(running);
    const controller = new AbortController();
    const extra = extraWith({ signal: controller.signal });

    const pending = waitForComplianceEvaluation.run(ctx, { workspace_id: "ws_1" }, extra);
    await vi.advanceTimersByTimeAsync(5_000);
    controller.abort();
    const result = await pending;

    expect(calls).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ...running, next: CANCELLED_NEXT });
  });

  it("passes ref and branch to the first read and waits on that run", async () => {
    const { ctx, calls } = contextWith(completed);

    await waitForComplianceEvaluation.run(
      ctx,
      { workspace_id: "ws_1", ref: "eval_1", enterprise_id: "ent_1" },
      extraWith()
    );

    expect(calls).toHaveBeenCalledWith("ent_1", "ws_1", "eval_1", undefined);
  });

  it("returns 'nothing on this branch' at once instead of waiting for a run that does not exist", async () => {
    const body = JSON.stringify({ code: "evaluation_not_found", message: "none" });
    const getComplianceEvaluation = vi.fn().mockRejectedValue(new ApiError(404, body, "/x"));
    const client = mockClient({ getComplianceEvaluation });
    const ctx = mockContext({
      client,
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
    });

    const result = await waitForComplianceEvaluation.run(
      ctx,
      { workspace_id: "ws_1", branch: "feature/x" },
      extraWith()
    );

    expect(getComplianceEvaluation).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ found: false, branch: "feature/x", waited_seconds: 0 });
    expect(result).not.toHaveProperty("next");
  });
});
