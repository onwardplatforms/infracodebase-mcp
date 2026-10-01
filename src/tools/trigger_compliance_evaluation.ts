import type { ToolDef } from "./helpers.js";

/**
 * Guidance rides along in the response instead of the tool description, where
 * clients truncate it. The agent reads `next` right after the call, which is
 * exactly when it is about to decide whether to poll.
 */
export const TRIGGER_NEXT =
  "This evaluation runs in the background like a CI check. Share `url` with the user and stop: " +
  "do not poll, sleep, or estimate how long it will take. Check the result once later with " +
  "get_compliance_evaluation, or when the user asks.";

const DEDUPED_NOTE =
  "A full evaluation for this commit was already running, so your scoped request was folded " +
  "into it (compare requested_scope and effective_scope). That is not an error. ";

/**
 * Trigger a compliance evaluation. With no scoping args, runs a full
 * evaluation. Pass ruleset_id, rule_id, or rule_ids to scope the run —
 * other rules' findings carry forward unchanged from the prior evaluation.
 * Fire-and-forget on the server: returns the queued/running evaluation
 * immediately, plus a `next` field saying what to do with it.
 */
export const triggerComplianceEvaluation: ToolDef = {
  name: "trigger_compliance_evaluation",
  async run(ctx, a) {
    if (a.rule_id && a.rule_ids?.length) {
      throw new Error("Pass either rule_id or rule_ids, not both.");
    }
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const result = (await ctx.client.triggerComplianceEvaluation(enterpriseId, a.workspace_id, {
      ref: a.ref,
      ruleset_id: a.ruleset_id,
      rule_id: a.rule_id,
      rule_ids: a.rule_ids,
    })) as Record<string, unknown> & { deduped?: boolean };

    return { ...result, next: result.deduped ? DEDUPED_NOTE + TRIGGER_NEXT : TRIGGER_NEXT };
  },
};
