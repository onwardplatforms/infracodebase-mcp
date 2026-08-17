import type { ToolDef } from "./helpers.js";

/**
 * Provider-neutral twin of `list_github_installations` (multi-VCS #1082).
 * The github_* name stays as a permanent stable alias; new consumers should
 * prefer this so GitLab/Bitbucket/ADO connections appear without a tool
 * change. Backed by the same GitHub endpoint while it's the only provider —
 * the mapping to neutral field names happens here.
 */
export const listVcsConnections: ToolDef = {
  name: "list_vcs_connections",
  run: async ({ client }, a) => {
    const result = (await client.listGitHubInstallations(a.enterprise_id)) as {
      installations?: Array<{
        id: string;
        installation_id: number;
        account_login: string;
        account_type: string;
      }>;
    };
    return {
      connections: (result.installations ?? []).map((i) => ({
        provider: "github",
        id: i.id,
        // Provider-side identity as a string: GitHub installation ids are
        // numeric, but other providers' identities won't be.
        provider_connection_id: String(i.installation_id),
        account: i.account_login,
        account_type: i.account_type,
      })),
    };
  },
};
