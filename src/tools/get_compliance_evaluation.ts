import type { ToolDef } from "./helpers.js";

/** Summary of a compliance evaluation; latest when no ref is given. */
export const getComplianceEvaluation: ToolDef = {
  name: "get_compliance_evaluation",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.getComplianceEvaluation(enterpriseId, a.workspace_id, a.ref);
  },
};
