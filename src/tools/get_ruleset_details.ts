import type { ToolDef } from "./helpers.js";

/** Load the full text of every rule in a single ruleset. */
export const getRulesetDetails: ToolDef = {
  name: "get_ruleset_details",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.getRulesetDetails(enterpriseId, a.ruleset_id);
  },
};
