import type { ToolDef } from "./helpers.js";
export const listRulesetSyncs: ToolDef = {
  name: "list_ruleset_syncs",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.listRulesetSyncs(enterpriseId, a.workspace_id, { cursor: a.cursor, status: a.status });
  },
};
