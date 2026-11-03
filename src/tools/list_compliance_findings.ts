import { omitFields, type ToolDef } from "./helpers.js";
import { FINDINGS_DEFAULT_LIMIT } from "./validation.js";

interface Finding {
  status?: string;
  exception?: { state?: string; pending_request?: unknown } | null;
}

/** The long text fields of a finding that `detail: "summary"` drops. */
const FINDING_TEXT_FIELDS = ["justification", "evidence", "delta_justification"] as const;

export const TRUNCATED_NOTE = (shown: number, total: number) =>
  `Showing ${shown} of ${total} findings. Narrow with status or ruleset_id, or raise limit, ` +
  "to see the rest. ";

export const UNCOVERED_NEXT = (n: number) =>
  `${n} failing rule${n === 1 ? " has" : "s have"} no exception in force. Fix what the code can ` +
  "fix first. For any that are left, classify each as risk_acceptance (a real violation the user " +
  "accepts) or not_applicable (the rule doesn't apply at this level), write a justification " +
  "specific to it, show the user the list, and call submit_compliance_exceptions only after they " +
  "agree, passing this response's evaluation_id so each exception is judged against the finding " +
  "you are looking at rather than the default branch's latest. A stale exception was granted " +
  "against older rule text and no longer applies, so it needs a new request.";

/**
 * A failure that nothing in force covers. A pending request counts as handled:
 * it's already waiting on an approver. Older self-hosted servers don't send
 * `exception` at all; without it we can't tell covered from uncovered, so
 * those rows never count.
 */
function isUncovered(f: Finding): boolean {
  return (
    f.status === "fail" &&
    "exception" in f &&
    (f.exception === null ||
      // A stale grant someone has already re-requested is handled.
      (f.exception?.state === "stale" && !f.exception.pending_request))
  );
}

/**
 * Per-rule findings from a compliance evaluation. The API returns every
 * finding; the list is cut to `limit` here, and the response reports the
 * full count so the agent knows to narrow or raise the limit. The uncovered
 * count in `next` is taken over everything the API returned, not just the
 * rows shown, so it stays right on a truncated page.
 */
export const listComplianceFindings: ToolDef = {
  name: "list_compliance_findings",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const result = (await ctx.client.listComplianceFindings(enterpriseId, a.workspace_id, {
      ref: a.ref,
      status: a.status,
      ruleset_id: a.ruleset_id,
    })) as { findings?: Finding[] } & Record<string, unknown>;
    if (!Array.isArray(result.findings)) return result;

    const all = result.findings;
    const shown = all.slice(0, a.limit ?? FINDINGS_DEFAULT_LIMIT);
    const truncated = shown.length < all.length;
    const summary = a.detail === "summary";
    const uncovered = all.filter(isUncovered).length;
    const next =
      (truncated ? TRUNCATED_NOTE(shown.length, all.length) : "") +
      (uncovered > 0 ? UNCOVERED_NEXT(uncovered) : "");

    return {
      ...result,
      findings: summary ? shown.map((f) => omitFields(f, FINDING_TEXT_FIELDS)) : shown,
      findings_total: all.length,
      ...(truncated ? { truncated: true } : {}),
      ...(summary ? { detail: "summary" } : {}),
      ...(next ? { next } : {}),
    };
  },
};
