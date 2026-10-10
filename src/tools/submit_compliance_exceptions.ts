import { ApiError } from "../client.js";
import type { ToolDef } from "./helpers.js";

export const REQUESTED_NEXT =
  "These are requests, not exceptions. Nothing changes until a compliance approver approves " +
  "them, and approvers are notified. Tell the user that plainly and do not describe these " +
  "findings as resolved.";

export const GRANTED_NEXT =
  "These exceptions are in force now for the whole workspace, with no further review. The rules " +
  "stop counting against the score until they are revoked or expire, and checks on open pull " +
  "requests are refreshed. Tell the user exactly that.";

export const FAILED_NEXT =
  "Some rules failed; each carries its error. rule_not_overridable means the rule is required " +
  "and can only be fixed, never excepted. rule_not_found means the rule_id isn't one this " +
  "workspace is evaluated against. exception_conflict means someone submitted on the same rule " +
  "at the same moment; retry that rule. exception_not_allowed means the finding's state rules " +
  "it out.";

/**
 * Errors about the caller or the request as a whole, not the rule: they
 * would fail every remaining rule the same way, so the batch stops.
 */
const CALLER_CODES = new Set([
  "user_context_required",
  "insufficient_scope",
  "cannot_manage_compliance",
  "cannot_approve_compliance",
  "workspace_not_found",
  "workspace_out_of_token_scope",
  "no_workspace_access",
  "not_an_enterprise_member",
]);

function stopsBatch(err: unknown) {
  if (!(err instanceof ApiError)) return true; // network or sign-in failure
  return (
    err.status === 401 ||
    err.status === 429 ||
    err.status >= 500 ||
    (err.code !== undefined && CALLER_CODES.has(err.code))
  );
}

function stoppedNext(code: string | undefined) {
  if (code === "user_context_required") {
    return (
      "Stopped: compliance decisions are recorded under a person's name, and this server is " +
      "connected with an enterprise access token. Ask the user to sign in with " +
      "`npx -y @infracodebase/mcp@latest login`, or use a personal access token, then retry."
    );
  }
  if (code === "cannot_approve_compliance") {
    return (
      "Stopped: the user can't grant exceptions on this workspace. Offer to submit the same " +
      "exceptions as requests instead (leave grant unset)."
    );
  }
  return (
    "Stopped: this error isn't about a specific rule, so the remaining rules were not " +
    "attempted. Resolve it, then resubmit the rules listed in not_attempted."
  );
}

interface ExceptionInput {
  rule_id: string;
  type: "risk_acceptance" | "not_applicable";
  justification: string;
  expires_in_days?: number;
}

/**
 * Request exceptions for a batch of rules, or grant them when the user has
 * explicitly said to grant. One API call per rule, in order, so one bad rule
 * doesn't sink the rest. An error about the caller rather than the rule
 * stops the batch instead of repeating for every rule.
 */
export const submitComplianceExceptions: ToolDef = {
  name: "submit_compliance_exceptions",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const mode = a.grant ? "grant" : "request";
    const entries = a.exceptions as ExceptionInput[];

    const requested: unknown[] = [];
    const granted: unknown[] = [];
    const failed: Array<{ rule_id: string; code?: string; error: string }> = [];

    for (const [i, e] of entries.entries()) {
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
        const code = err instanceof ApiError ? err.code : undefined;
        const error = err instanceof Error ? err.message : String(err);
        if (stopsBatch(err)) {
          // Nothing to report but this error: surface it as a plain tool error.
          if (requested.length === 0 && granted.length === 0 && failed.length === 0) throw err;
          return {
            requested,
            granted,
            failed,
            stopped: { code, error },
            not_attempted: entries.slice(i).map((x) => x.rule_id),
            next: [
              requested.length ? REQUESTED_NEXT : null,
              granted.length ? GRANTED_NEXT : null,
              failed.length ? FAILED_NEXT : null,
              stoppedNext(code),
            ]
              .filter(Boolean)
              .join(" "),
          };
        }
        failed.push({ rule_id: e.rule_id, code, error });
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
