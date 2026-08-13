import type { ToolDef } from "./helpers.js";

/**
 * Full workspace context, resolved from either an explicit workspace_id or a
 * repo_url in a single server-side request. Response `status` is one of
 * `linked`, `unlinked` (no workspace matches), `no_access` (a workspace
 * exists but the caller can't see it), or `ambiguous` (the repo matches
 * workspaces in more than one enterprise the caller can see).
 */
export const getWorkspaceContext: ToolDef = {
  name: "get_workspace_context",
  async run(ctx, a) {
    if (!a.workspace_id && !a.repo_url) {
      throw new Error("Provide either workspace_id or repo_url.");
    }
    return ctx.client.resolveWorkspaceContext({
      repoUrl: a.repo_url,
      workspaceId: a.workspace_id,
      iacTool: a.iac_tool,
    });
  },
};
