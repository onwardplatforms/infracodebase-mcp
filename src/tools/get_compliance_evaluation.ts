import type { ToolDef } from "./helpers.js";

/**
 * Summary of a compliance evaluation; latest when no ref is given. `branch`
 * scopes "latest" to that branch (server falls back to the workspace's
 * default branch, then to the most recent completed evaluation on any
 * branch); ignored when `ref` is given.
 */
export const getComplianceEvaluation: ToolDef = {
  name: "get_compliance_evaluation",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.getComplianceEvaluation(enterpriseId, a.workspace_id, a.ref, a.branch);
  },
};
