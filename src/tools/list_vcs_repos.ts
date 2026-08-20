import type { ToolDef } from "./helpers.js";

/** Repositories accessible via a version-control connection (any provider). */
export const listVcsRepos: ToolDef = {
  name: "list_vcs_repos",
  run: ({ client }, a) => client.listVcsRepos(a.enterprise_id, a.connection_id, a.search),
};
