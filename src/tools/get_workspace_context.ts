import type { ToolDef } from "./helpers.js";

/**
 * Full workspace context, resolved from either an explicit workspace_id or a
 * repo_url. A repo_url that matches no workspace returns { status: 'unlinked' }
 * rather than throwing, so the agent can offer to link it.
 */
export const getWorkspaceContext: ToolDef = {
  name: "get_workspace_context",
  async run(ctx, a) {
    let workspaceId: string;
    let enterpriseId: string;

    if (a.workspace_id) {
      workspaceId = a.workspace_id;
      enterpriseId = await ctx.getEnterpriseForWorkspace(workspaceId, a.enterprise_id);
    } else if (a.repo_url) {
      const ws = await ctx.resolveWorkspaceByRepo(a.repo_url);
      if (!ws) {
        return {
          status: "unlinked",
          repo_url: a.repo_url,
          message:
            "No workspace is linked to this repo. Use list_workspaces to find one, " +
            "or link_workspace_to_repo to connect it.",
        };
      }
      workspaceId = ws.id;
      enterpriseId = ws.enterprise_id;
    } else {
      throw new Error("Provide either workspace_id or repo_url.");
    }

    return ctx.client.getWorkspaceContext(enterpriseId, workspaceId, a.iac_tool);
  },
};
