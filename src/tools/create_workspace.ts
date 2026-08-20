import type { ToolDef } from "./helpers.js";

/**
 * Create a workspace, optionally linking it to a repo (any provider). The repo
 * link is only sent when all three repo fields are present.
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
