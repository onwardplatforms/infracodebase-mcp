import type { ToolDef } from "./helpers.js";
export const applyRulesetSync: ToolDef = {
  name: "apply_ruleset_sync",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.applyRulesetSync(enterpriseId, a.workspace_id, a.run_id, a.selected_change_ids);
  },
};
