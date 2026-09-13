import type { ToolDef } from "./helpers.js";
export const dismissRulesetSync: ToolDef = {
  name: "dismiss_ruleset_sync",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.dismissRulesetSync(enterpriseId, a.workspace_id, a.run_id);
  },
};
