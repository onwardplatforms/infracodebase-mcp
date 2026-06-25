import type { ToolDef } from "./helpers.js";

/**
 * Create a workspace, optionally linking it to a GitHub repo. The repo link is
 * only sent when all four github_* fields are present.
 */
export const createWorkspace: ToolDef = {
  name: "create_workspace",
  run({ client }, a) {
    const body: Record<string, unknown> = {
      name: a.name,
      description: a.description,
      ruleset_ids: a.ruleset_ids,
      mcp_server_ids: a.mcp_server_ids,
      workflow_ids: a.workflow_ids,
    };

    if (a.github_installation_id && a.github_owner && a.github_repo && a.github_branch) {
      body.github = {
        installation_id: a.github_installation_id,
        owner: a.github_owner,
        repo: a.github_repo,
        branch: a.github_branch,
      };
    }

    return client.createWorkspace(a.enterprise_id, body);
  },
};
