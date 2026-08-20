import type { ToolDef } from "./helpers.js";

/** Link a workspace to a repo (any provider) for compliance evaluations on push. */
export const linkWorkspaceToRepo: ToolDef = {
  name: "link_workspace_to_repo",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.linkWorkspaceToRepo(enterpriseId, a.workspace_id, {
      connection_id: a.connection_id,
      path: a.repo_path,
      branch: a.branch,
    });
  },
};
