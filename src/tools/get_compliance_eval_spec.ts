import type { ToolDef } from "./helpers.js";

/** The system prompt and conventions the CI compliance evaluator uses. */
export const getComplianceEvalSpec: ToolDef = {
  name: "get_compliance_eval_spec",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.getComplianceEvalSpec(enterpriseId, a.workspace_id);
  },
};
