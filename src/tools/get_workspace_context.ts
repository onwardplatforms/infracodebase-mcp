import type { ToolDef } from "./helpers.js";

export const getWorkspaceContext: ToolDef = {
  name: "get_workspace_context",
  async run(ctx, a) {
    const repo = a.workspace_id ? null : await ctx.resolveRepoUrl(a.repo_url);
    const result = await ctx.client.getBuildContext({
      repoUrl: repo?.repo_url,
      workspaceId: a.workspace_id,
      enterpriseId: a.enterprise_id,
      rulesetIds: a.ruleset_ids,
      iacTool: a.iac_tool,
      branch: a.branch,
    });
    return {
      ...(result as Record<string, unknown>),
      ...(repo
        ? { resolved_repo_url: repo.repo_url ?? null, resolved_from: repo.resolved_from }
        : {}),
    };
  },
};
