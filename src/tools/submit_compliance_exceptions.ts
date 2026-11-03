import { ApiError } from "../client.js";
import type { ToolDef } from "./helpers.js";

export const REQUESTED_NEXT =
  "These are requests, not exceptions. Nothing changes until a compliance approver approves " +
  "them, and approvers have been notified. Tell the user that plainly and do not describe these " +
  "findings as resolved.";

export const GRANTED_NEXT =
  "These exceptions are in force now for the whole workspace, with no further review. The rules " +
  "stop counting against the score and stop blocking merges until they are revoked or expire. " +
  "Tell the user exactly that.";

export const FAILED_NEXT =
  "Some submissions failed; each carries its error. rule_not_overridable means the rule is " +
  "required and can only be fixed, never excepted. cannot_approve_compliance on a grant means " +
  "the user can't grant; offer to submit the same exceptions as requests instead.";

interface ExceptionInput {
  rule_id: string;
  type: "risk_acceptance" | "not_applicable";
  justification: string;
  expires_in_days?: number;
}

/**
 * Request exceptions for a batch of rules, or grant them when the user has
 * explicitly said to grant. One API call per rule, in order, so one bad rule
 * doesn't sink the rest.
 */
export const submitComplianceExceptions: ToolDef = {
  name: "submit_compliance_exceptions",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const mode = a.grant ? "grant" : "request";

    const requested: unknown[] = [];
    const granted: unknown[] = [];
    const failed: Array<{ rule_id: string; code?: string; error: string }> = [];

    for (const e of a.exceptions as ExceptionInput[]) {
      try {
        const result = await ctx.client.submitComplianceException(enterpriseId, a.workspace_id, {
          rule_id: e.rule_id,
          type: e.type,
          justification: e.justification,
          expires_in_days: e.expires_in_days,
          evaluation_id: a.evaluation_id,
          mode,
        });
        (result.state === "active" ? granted : requested).push(result);
      } catch (err) {
        failed.push({
          rule_id: e.rule_id,
          code: err instanceof ApiError ? err.code : undefined,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const next = [
      requested.length ? REQUESTED_NEXT : null,
      granted.length ? GRANTED_NEXT : null,
      failed.length ? FAILED_NEXT : null,
    ]
      .filter(Boolean)
      .join(" ");
    return { requested, granted, failed, next };
  },
};
