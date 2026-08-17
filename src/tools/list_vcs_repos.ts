import type { ToolDef } from "./helpers.js";

/**
 * Provider-neutral twin of `list_github_repos` (multi-VCS #1082). The
 * github_* name stays as a permanent stable alias. `display_path` is the
 * provider's full repo path — owner/name on GitHub, potentially more
 * segments on other providers (GitLab subgroups, Azure DevOps projects).
 */
export const listVcsRepos: ToolDef = {
  name: "list_vcs_repos",
  run: async ({ client }, a) => {
    const result = (await client.listGitHubRepos(
      a.enterprise_id,
      a.connection_id,
      a.search
    )) as {
      repositories?: Array<{
        name: string;
        full_name: string;
        owner: string;
        default_branch: string;
        private: boolean;
      }>;
    };
    return {
      repositories: (result.repositories ?? []).map((r) => ({
        provider: "github",
        display_path: r.full_name,
        name: r.name,
        owner: r.owner,
        default_branch: r.default_branch,
        private: r.private,
      })),
    };
  },
};
