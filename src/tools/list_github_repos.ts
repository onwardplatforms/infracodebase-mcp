import type { ToolDef } from "./helpers.js";

/** Repositories accessible via a GitHub App installation. */
export const listGithubRepos: ToolDef = {
  name: "list_github_repos",
  run: ({ client }, a) => client.listGitHubRepos(a.enterprise_id, a.installation_id, a.search),
};
