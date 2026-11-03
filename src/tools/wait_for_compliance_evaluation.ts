import type { ToolDef, ToolExtra } from "./helpers.js";
import { getComplianceEvaluation } from "./get_compliance_evaluation.js";

/** Statuses the API uses for an evaluation that has not finished yet. */
const IN_FLIGHT = new Set(["queued", "pending", "running", "in_progress"]);

export const DEFAULT_POLL_INTERVAL_MS = 20_000;
export const MAX_WAIT_MINUTES = 25;

export const COMPLETED_NEXT =
  "The evaluation finished. Report result, score, and `url` to the user. For failing rules, " +
  "call list_compliance_findings with ref set to this evaluation's id.";

export const FAILED_NEXT =
  "The evaluation failed to run (see error_message). Share `url` with the user; a re-run needs " +
  "a new trigger_compliance_evaluation call, and only if the user asks for one.";

export const CAP_NEXT =
  "The evaluation was still running when the wait limit was reached. Share `url` with the user " +
  "and stop; do not poll, sleep, or estimate how long it will take. Call this tool again only " +
  "when the user asks for the result.";

export const CANCELLED_NEXT =
  "The wait was cancelled before the evaluation finished. It keeps running on the server; share " +
  "`url` with the user, and call this tool again only when they ask for the result.";

type Evaluation = Record<string, unknown> & {
  id?: string;
  status?: string;
  found?: boolean;
  next?: string;
};

/** Fakeable timing for tests. `sleep` resolves after `ms` or when `signal` aborts. */
export interface WaitOptions {
  intervalMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Tell the client how the wait is going. Only when it asked for progress
 * (a progressToken on the request); a client without one gets nothing, and a
 * client that closed the connection must not take the tool down with it.
 */
async function reportProgress(extra: ToolExtra | undefined, polls: number, message: string) {
  const progressToken = extra?._meta?.progressToken;
  if (progressToken === undefined) return;
  try {
    await extra!.sendNotification({
      method: "notifications/progress",
      params: { progressToken, progress: polls, message },
    });
  } catch {
    // Progress is a courtesy. The result still arrives when the wait ends.
  }
}

function isDone(evaluation: Evaluation) {
  return evaluation.found === false || !evaluation.status || !IN_FLIGHT.has(evaluation.status);
}

/** The evaluation as returned to the agent, with this tool's own `next` in place of the read tool's. */
function withNext(evaluation: Evaluation, waitedMs: number, next?: string) {
  const { next: _replaced, ...rest } = evaluation;
  return { ...rest, waited_seconds: Math.round(waitedMs / 1000), ...(next ? { next } : {}) };
}

function finished(evaluation: Evaluation, waitedMs: number) {
  if (evaluation.found === false) return withNext(evaluation, waitedMs);
  const failed = evaluation.status === "failed" || evaluation.status === "error";
  return withNext(evaluation, waitedMs, failed ? FAILED_NEXT : COMPLETED_NEXT);
}

/**
 * Wait, server-side, for a compliance evaluation to finish, then return it.
 *
 * The agent calls this once; the polling happens here, so the agent never
 * has to sleep or loop. The first read goes through get_compliance_evaluation
 * (branch detection and the "nothing on this branch" answer included); the
 * polls that follow pin the evaluation by id so "latest" cannot drift to a
 * different run mid-wait. Progress notifications go out on every poll when
 * the client asked for them, which is what keeps a long call alive in
 * clients with an idle timeout. The wait is capped so a client that blocks
 * on tool calls gets its turn back; the run keeps going on the server.
 */
export function createWaitForComplianceEvaluation(options: WaitOptions = {}): ToolDef {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  // Looked up per call, not bound at import, so a faked clock in tests counts.
  const now = options.now ?? (() => Date.now());

  return {
    name: "wait_for_compliance_evaluation",
    async run(ctx, a, extra) {
      const minutes = Math.min(a.max_wait_minutes ?? MAX_WAIT_MINUTES, MAX_WAIT_MINUTES);
      const started = now();
      const deadline = started + minutes * 60_000;
      const signal = extra?.signal;

      let evaluation = (await getComplianceEvaluation.run(ctx, {
        workspace_id: a.workspace_id,
        ref: a.ref,
        branch: a.branch,
        enterprise_id: a.enterprise_id,
      })) as Evaluation;
      if (isDone(evaluation)) return finished(evaluation, now() - started);

      // From here on, ask for this run by id so a newer run on the branch
      // does not replace the one the user is waiting on.
      const ref = evaluation.id ?? a.ref;
      let polls = 0;
      while (now() < deadline) {
        await sleep(Math.min(intervalMs, deadline - now()), signal);
        if (signal?.aborted) return withNext(evaluation, now() - started, CANCELLED_NEXT);
        polls += 1;
        const elapsed = Math.round((now() - started) / 1000);
        await reportProgress(
          extra,
          polls,
          `Compliance evaluation ${evaluation.status} after ${elapsed}s`
        );
        evaluation = (await getComplianceEvaluation.run(ctx, {
          workspace_id: a.workspace_id,
          ref,
          enterprise_id: a.enterprise_id,
        })) as Evaluation;
        if (isDone(evaluation)) return finished(evaluation, now() - started);
      }
      return withNext(evaluation, now() - started, CAP_NEXT);
    },
  };
}

export const waitForComplianceEvaluation = createWaitForComplianceEvaluation();
