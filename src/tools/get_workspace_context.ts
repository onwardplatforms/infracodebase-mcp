import type { ToolDef } from "./helpers.js";

/**
 * Full workspace context, resolved from an explicit workspace_id, an explicit
 * repo_url, or (with no arguments) the repo the agent is working in. Response
 * `status` is one of `linked`, `unlinked` (no workspace matches), `no_access`
 * (a workspace exists but the caller can't see it), or `ambiguous` (the repo
 * matches workspaces in more than one enterprise the caller can see).
 */
export const getWorkspaceContext: ToolDef = {
  name: "get_workspace_context",
  async run(ctx, a) {
    if (a.workspace_id) {
      return ctx.client.resolveWorkspaceContext({
        repoUrl: undefined,
        workspaceId: a.workspace_id,
        iacTool: a.iac_tool,
      });
    }

    const repo = await ctx.resolveRepoUrl(a.repo_url);
    const result = await ctx.client.resolveWorkspaceContext({
      repoUrl: repo.repo_url,
      workspaceId: undefined,
      iacTool: a.iac_tool,
    });
    if (repo.resolved_from === "argument") return result;

    // Auto-detection is reported, never silent, so the agent and the user can
    // see which repo the answer is about.
    return {
      ...(result as Record<string, unknown>),
      resolved_repo_url: repo.repo_url,
      resolved_from: repo.resolved_from,
    };
  },
};
