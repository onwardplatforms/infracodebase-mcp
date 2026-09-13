import type { ToolDef } from "./helpers.js";
export const startRulesetSync: ToolDef = {
  name: "start_ruleset_sync",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.startRulesetSync(enterpriseId, a.workspace_id, a.request_key);
  },
};
