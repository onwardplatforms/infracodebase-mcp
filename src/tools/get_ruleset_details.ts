import type { ToolDef } from "./helpers.js";

/** See TOOL_DESCRIPTIONS.get_ruleset_details in validation.ts for the agent-facing description. */
export const getRulesetDetails: ToolDef = {
  name: "get_ruleset_details",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.getRulesetDetails(enterpriseId, a.ruleset_id);
  },
};
