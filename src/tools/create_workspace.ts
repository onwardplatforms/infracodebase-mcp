import type { ToolDef } from "./helpers.js";

/**
 * Create a workspace, optionally linking it to a repo (any provider). The repo
 * link is only sent when all three repo fields are present.
 */
export const createWorkspace: ToolDef = {
  name: "create_workspace",
  async run({ client }, a) {
    const body: Record<string, unknown> = {
      name: a.name,
      description: a.description,
      ruleset_ids: a.ruleset_ids,
      mcp_server_ids: a.mcp_server_ids,
      workflow_ids: a.workflow_ids,
    };

    // The repo link is all-or-nothing. Reject a partial set loudly rather than
    // silently creating an unlinked workspace and reporting success, which
    // would leave the repo ungoverned with no signal that anything was missed.
    const repoFields = [a.connection_id, a.repo_path, a.branch];
    const provided = repoFields.filter(Boolean).length;
    if (provided > 0 && provided < repoFields.length) {
      throw new Error(
        "To link a repo, pass all of connection_id, repo_path, and branch. " +
          "Omit all three to create a workspace without linking a repo."
      );
    }

    if (a.connection_id && a.repo_path && a.branch) {
      body.repository = {
        connection_id: a.connection_id,
        path: a.repo_path,
        branch: a.branch,
      };
    }

    return client.createWorkspace(a.enterprise_id, body);
  },
};
