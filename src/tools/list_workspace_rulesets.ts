import type { ToolDef } from "./helpers.js";

/** See TOOL_DESCRIPTIONS.list_workspace_rulesets in validation.ts for the agent-facing description. */
export const listWorkspaceRulesets: ToolDef = {
  name: "list_workspace_rulesets",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.listWorkspaceRulesets(enterpriseId, a.workspace_id);
  },
};
