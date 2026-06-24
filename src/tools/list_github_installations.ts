import type { ToolDef } from "./helpers.js";

/** GitHub App installations configured for an enterprise. */
export const listGithubInstallations: ToolDef = {
  name: "list_github_installations",
  run: ({ client }, a) => client.listGitHubInstallations(a.enterprise_id),
};
