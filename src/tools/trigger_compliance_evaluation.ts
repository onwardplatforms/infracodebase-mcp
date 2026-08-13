import type { ToolDef } from "./helpers.js";

/**
 * Trigger a compliance evaluation. With no scoping args, runs a full
 * evaluation. Pass ruleset_id, rule_id, or rule_ids to scope the run —
 * other rules' findings carry forward unchanged from the prior evaluation.
 * Fire-and-forget on the server: returns the queued/running evaluation
 * immediately. Check status later via get_compliance_evaluation — don't
 * tight-loop it (see TOOL_DESCRIPTIONS for the full agent-facing guidance).
 */
export const triggerComplianceEvaluation: ToolDef = {
  name: "trigger_compliance_evaluation",
  async run(ctx, a) {
    if (a.rule_id && a.rule_ids?.length) {
      throw new Error("Pass either rule_id or rule_ids, not both.");
    }
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.triggerComplianceEvaluation(enterpriseId, a.workspace_id, {
      ref: a.ref,
      ruleset_id: a.ruleset_id,
      rule_id: a.rule_id,
      rule_ids: a.rule_ids,
    });
  },
};
