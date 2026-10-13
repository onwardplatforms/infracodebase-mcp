import type { ToolDef } from "./helpers.js";

interface Finding {
  status?: string;
  exception?: { state?: string; pending_request?: unknown } | null;
}

export const UNCOVERED_NEXT = (n: number) =>
  `${n} failing rule${n === 1 ? " has" : "s have"} no exception in force. Fix what the code can ` +
  "fix first. For any that are left, classify each as risk_acceptance (a real violation the user " +
  "accepts) or not_applicable (the rule doesn't apply at this level), write a justification " +
  "specific to it, show the user the list, and call submit_compliance_exceptions only after they " +
  "agree. A stale exception was granted against older rule text and no longer applies, so it " +
  "needs a new request.";

/**
 * Per-rule findings from a compliance evaluation. When failures remain that
 * no exception in force covers, a `next` field says how to close them out.
 * A pending request counts as handled: it's already waiting on an approver.
 */
export const listComplianceFindings: ToolDef = {
  name: "list_compliance_findings",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const result = (await ctx.client.listComplianceFindings(enterpriseId, a.workspace_id, {
      ref: a.ref,
      status: a.status,
    })) as { findings?: Finding[] } & Record<string, unknown>;

    // Older self-hosted servers don't send `exception` at all; without it we
    // can't tell covered from uncovered, so say nothing.
    const uncovered = (result.findings ?? []).filter(
      (f) =>
        f.status === "fail" &&
        "exception" in f &&
        (f.exception === null ||
          // A stale grant someone has already re-requested is handled.
          (f.exception?.state === "stale" && !f.exception.pending_request))
    ).length;
    return uncovered > 0 ? { ...result, next: UNCOVERED_NEXT(uncovered) } : result;
  },
};
