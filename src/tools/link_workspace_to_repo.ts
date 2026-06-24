import type { ToolDef } from "./helpers.js";

/** Link a workspace to a GitHub repo for compliance evaluations on push. */
export const linkWorkspaceToRepo: ToolDef = {
  name: "link_workspace_to_repo",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.linkWorkspaceToRepo(enterpriseId, a.workspace_id, {
      installation_id: a.github_installation_id,
      owner: a.github_owner,
      repo: a.github_repo,
      branch: a.github_branch,
    });
  },
};
