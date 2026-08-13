import type { ToolDef } from "./helpers.js";

/** List every ruleset relevant to a workspace, including ones not yet attached. */
export const listWorkspaceRulesets: ToolDef = {
  name: "list_workspace_rulesets",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.listWorkspaceRulesets(enterpriseId, a.workspace_id);
  },
};
