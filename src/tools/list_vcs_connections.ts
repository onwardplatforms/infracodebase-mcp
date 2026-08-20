import type { ToolDef } from "./helpers.js";

/** Version-control connections (GitHub, GitLab, …) configured for an enterprise. */
export const listVcsConnections: ToolDef = {
  name: "list_vcs_connections",
  run: ({ client }, a) => client.listVcsConnections(a.enterprise_id, a.provider),
};
