import type { ToolDef } from "./helpers.js";

/** Add or remove rulesets, MCP servers, or workflows on a workspace. */
export const updateWorkspaceResources: ToolDef = {
  name: "update_workspace_resources",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.updateWorkspaceResources(enterpriseId, a.workspace_id, {
      add_ruleset_ids: a.add_ruleset_ids,
      remove_ruleset_ids: a.remove_ruleset_ids,
      add_mcp_server_ids: a.add_mcp_server_ids,
      remove_mcp_server_ids: a.remove_mcp_server_ids,
      add_workflow_ids: a.add_workflow_ids,
      remove_workflow_ids: a.remove_workflow_ids,
    });
  },
};
