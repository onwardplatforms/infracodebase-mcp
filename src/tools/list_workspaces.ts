import type { ToolDef } from "./helpers.js";

/** List workspaces in an enterprise. */
export const listWorkspaces: ToolDef = {
  name: "list_workspaces",
  run: ({ client }, a) => client.listWorkspaces(a.enterprise_id),
};
