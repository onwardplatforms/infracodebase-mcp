import type { ToolDef } from "./helpers.js";

interface BuildContext {
  status: string;
  can_generate: boolean;
  message?: string;
  enterprise?: { id: string };
  repository?: { host: string; name: string; displayPath: string };
  workspace?: { id: string };
  setup?: { enterprise_id: string; ruleset_ids: string[] };
}
interface Connection {
  id: string;
  host: string;
  provider: string;
}
interface Repo {
  path: string;
  web_url: string;
}
interface SetupResult {
  workspace?: { id: string };
  repository_linked?: boolean;
  repository_error?: string;
  warning?: string;
}

/** The agent carries the drafting selection, not a hidden mutable server session. */
export const setupWorkspace: ToolDef = {
  name: "setup_workspace",
  async run(ctx, a) {
    const detected = await ctx.resolveRepoUrl(a.repo_url);
    if (!detected.repo_url)
      return {
        status: "no_repository",
        message:
          "Keep drafting locally. Call setup_workspace once a remote repository exists and has a pushed branch. No workspace was created.",
      };
    const context = (await ctx.client.getBuildContext({
      repoUrl: detected.repo_url,
      enterpriseId: a.enterprise_id,
      rulesetIds: a.ruleset_ids,
      branch: a.branch,
      iacTool: a.iac_tool,
    })) as BuildContext;
    if (context.status === "linked")
      return {
        status: "already_linked",
        context,
        message:
          "Use this existing workspace and its configured rules. Compare with your draft; do not silently attach different rules. Check the pushed branch for an evaluation before triggering one.",
      };
    if (
      context.status !== "unlinked" ||
      !context.can_generate ||
      !context.repository ||
      !context.setup
    )
      return context;
    const { host, displayPath, name } = context.repository;
    const enterpriseId = context.setup.enterprise_id;
    const connections = (
      (await ctx.client.listVcsConnections(enterpriseId)) as { data: Connection[] }
    ).data;
    const candidates = connections.filter(
      (c) =>
        c.host.toLowerCase() === host.toLowerCase() &&
        (!a.connection_id || c.id === a.connection_id)
    );
    const matches = (
      await Promise.all(
        candidates.map(async (connection) => {
          // Failures propagate: an unavailable connection is not an empty repo list.
          const repos = (
            (await ctx.client.listVcsRepos(enterpriseId, connection.id, name)) as { data: Repo[] }
          ).data;
          return repos
            .filter((repo) =>
              connection.provider === "github"
                ? repo.path.toLowerCase() === displayPath.toLowerCase()
                : repo.path === displayPath
            )
            .map((repo) => ({ connection, repo }));
        })
      )
    ).flat();
    if (!matches.length)
      return {
        status: "repository_access_required",
        context,
        message:
          "Infracodebase cannot access this repository through the selected enterprise's version-control connections. Connect an account with repository access, then retry. No workspace was created.",
      };
    if (matches.length > 1)
      return {
        status: "needs_connection",
        connections: matches.map((m) => m.connection),
        context,
        message:
          "More than one connection can access this repository. Choose connection_id and retry; no workspace was created.",
      };
    const match = matches[0];
    const result = (await ctx.client.createWorkspace(enterpriseId, {
      name: a.workspace_name ?? name,
      ruleset_ids: context.setup.ruleset_ids,
      repository: { connection_id: match.connection.id, path: match.repo.path, branch: a.branch },
    })) as SetupResult;
    if (!result.repository_linked || result.warning)
      return {
        status: "setup_incomplete",
        ...result,
        setup: context.setup,
        message:
          result.repository_error ??
          result.warning ??
          "Workspace setup is incomplete. Use the returned workspace ID to finish repository linking; do not create another workspace.",
      };
    if (!result.workspace?.id)
      throw new Error(
        "Workspace setup returned no workspace ID. Check the workspace list before retrying creation."
      );
    const verified = (await ctx.client.getBuildContext({
      workspaceId: result.workspace.id,
      enterpriseId,
      branch: a.branch,
      iacTool: a.iac_tool,
    })) as BuildContext;
    const attached = new Set(verified.setup?.ruleset_ids ?? []);
    if (
      verified.status !== "linked" ||
      !verified.can_generate ||
      context.setup.ruleset_ids.some((id) => !attached.has(id))
    )
      return {
        status: "ruleset_verification_required",
        ...result,
        context: verified,
        message:
          "The workspace exists, but its effective rules do not match the draft selection. Resolve this before reporting compliance readiness; do not recreate the workspace.",
      };
    return {
      status: "ready",
      ...result,
      context: verified,
      message:
        "Repository linking and webhook setup completed without warnings. Recheck your code against the returned current rules. After pushing, check once for an evaluation on this branch; if none covers the pushed commit, trigger one with the branch ref. Report its URL, not an unverified compliance claim.",
    };
  },
};
