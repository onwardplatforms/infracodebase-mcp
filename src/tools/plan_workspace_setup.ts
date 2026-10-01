import type { ToolDef } from "./helpers.js";

/**
 * One read-only call that replaces the five lookups an agent used to chain
 * (list_enterprises, list_vcs_connections, list_vcs_repos, list_workspaces,
 * list_enterprise_resources) before it could set a repo up. It resolves the
 * repo, searches every enterprise's connections for it, and returns either a
 * `proposed` plan with the decisions the user still owns, or a status saying
 * what blocked it. It never writes: `setup_workspace` applies the plan once
 * the user has confirmed.
 */

interface Enterprise {
  id: string;
  name?: string;
  slug?: string;
}
interface Connection {
  id: string;
  provider?: string;
  host?: string;
  account?: string;
}
interface VcsRepo {
  path: string;
  name?: string;
  default_branch?: string;
  web_url?: string;
}
interface Resource {
  id: string;
  name?: string;
  description?: string | null;
  required?: boolean;
}
interface WorkspaceRow {
  id: string;
  name?: string;
  slug?: string;
  description?: string | null;
  linked_repository?: { owner?: string; name?: string } | null;
}
interface ContextResponse {
  status: string;
  owner?: string;
  name?: string;
  message?: string;
  workspace?: unknown;
  candidates?: unknown;
}
interface Match {
  enterprise: Enterprise;
  connection: Connection;
  repo: VcsRepo;
}

const rows = <T>(res: unknown): T[] => (res as { data?: T[] } | undefined)?.data ?? [];
const sameIgnoringCase = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const planWorkspaceSetup: ToolDef = {
  name: "plan_workspace_setup",
  async run(ctx, a) {
    const { client } = ctx;
    const detected = await ctx.resolveRepoUrl(a.repo_url);
    const repo = { url: detected.repo_url, resolved_from: detected.resolved_from };

    // The server parses the URL (any provider, ssh or https) and tells us
    // whether the repo is already governed, so no client-side URL parsing.
    const context = (await client.resolveWorkspaceContext({
      repoUrl: repo.url,
    })) as ContextResponse;

    if (context.status === "linked") {
      return {
        status: "already_linked",
        repo,
        workspace: context.workspace,
        next: "This repo is already governed. Nothing to set up: use the context from get_workspace_context and write against its rulesets.",
      };
    }
    if (context.status !== "unlinked") {
      return {
        status: context.status,
        repo,
        message: context.message,
        candidates: context.candidates,
        next: "Follow `message` before doing anything else.",
      };
    }

    const owner = context.owner ?? "";
    const name = context.name ?? "";
    const path = `${owner}/${name}`;

    const enterprises = rows<Enterprise>(await client.listEnterprises());
    const scope = a.enterprise_id
      ? enterprises.filter((e) => e.id === a.enterprise_id)
      : enterprises;
    if (a.enterprise_id && scope.length === 0) {
      throw new Error(
        `enterprise_id ${a.enterprise_id} is not an enterprise this token can access. Call list_enterprises.`
      );
    }
    if (scope.length === 0) {
      throw new Error(
        "This token belongs to no enterprise. Ask an enterprise admin for an invitation before setting up a repo."
      );
    }

    // Search every enterprise's connections for the repo path concurrently. A
    // single match settles both the enterprise and the connection without a
    // question; several matches become a decision for the user.
    const matches: Match[] = [];
    const similar: Array<{ enterprise_id: string; connection_id: string; path: string; web_url?: string }> = [];
    const scanned: Array<{
      enterprise_id: string;
      connection_id: string;
      provider?: string;
      account?: string;
      repos_matching_name: number;
    }> = [];

    await Promise.all(
      scope.map(async (enterprise) => {
        let connections = rows<Connection>(await client.listVcsConnections(enterprise.id));
        if (a.connection_id) connections = connections.filter((c) => c.id === a.connection_id);
        await Promise.all(
          connections.map(async (connection) => {
            const repos = rows<VcsRepo>(await client.listVcsRepos(enterprise.id, connection.id, name));
            scanned.push({
              enterprise_id: enterprise.id,
              connection_id: connection.id,
              provider: connection.provider,
              account: connection.account,
              repos_matching_name: repos.length,
            });
            for (const r of repos) {
              // The API already filtered by name, so every non-exact hit is a
              // plausible "did you mean" (a fork, a different org, a rename).
              if (sameIgnoringCase(r.path, path)) matches.push({ enterprise, connection, repo: r });
              else {
                similar.push({
                  enterprise_id: enterprise.id,
                  connection_id: connection.id,
                  path: r.path,
                  web_url: r.web_url,
                });
              }
            }
          })
        );
      })
    );

    if (matches.length === 0) {
      return {
        status: "repo_not_found",
        repo: { ...repo, path, owner, name },
        scanned,
        similar: similar.slice(0, 5),
        next:
          `No version-control connection can see ${path}. Ask the user whether the repo exists yet. ` +
          "If it does not, create it with the provider's CLI (gh repo create / glab repo create), push an " +
          "initial commit, then call plan_workspace_setup again. If it does exist, the connection lacks " +
          "access to it (install the app on that organization or add the repo to it), or the repo lives " +
          "under a different account: check `similar`.",
      };
    }

    if (matches.length > 1) {
      return {
        status: "needs_decision",
        repo: { ...repo, path, owner, name },
        decisions_needed: [
          {
            decision: "connection",
            question: `Which enterprise and connection should govern ${path}?`,
            options: matches.map((m) => ({
              enterprise_id: m.enterprise.id,
              enterprise: m.enterprise.name,
              connection_id: m.connection.id,
              provider: m.connection.provider,
              account: m.connection.account,
            })),
          },
        ],
        next: "Ask the user to pick one, then call plan_workspace_setup again with that enterprise_id and connection_id.",
      };
    }

    const [match] = matches;
    const [workspaces, resources] = await Promise.all([
      client.listWorkspaces(match.enterprise.id, ["STANDARD", "TEMPLATE", "MODULE"]),
      client.listEnterpriseResources(match.enterprise.id),
    ]);
    const workspaceRows = rows<WorkspaceRow>(workspaces);

    const owning = workspaceRows.find(
      (w) =>
        w.linked_repository &&
        sameIgnoringCase(`${w.linked_repository.owner}/${w.linked_repository.name}`, path)
    );
    if (owning) {
      return {
        status: "already_linked",
        repo: { ...repo, path, owner, name },
        workspace: { id: owning.id, name: owning.name, slug: owning.slug },
        next: `Workspace "${owning.name}" already owns ${path}. Call get_workspace_context with workspace_id ${owning.id}.`,
      };
    }

    const unlinkedWorkspaces = workspaceRows
      .filter((w) => !w.linked_repository)
      .map(({ id, name: wsName, slug, description }) => ({ id, name: wsName, slug, description }))
      .slice(0, 10);

    const rulesets = (resources as { rulesets?: Resource[] } | undefined)?.rulesets ?? [];
    const summarize = (r: Resource) => ({ id: r.id, name: r.name, description: r.description });
    const required = rulesets.filter((r) => r.required);
    const optional = rulesets.filter((r) => !r.required);
    const branch = match.repo.default_branch || "main";

    const decisions: Array<{ decision: string; question: string; options: unknown[] }> = [
      {
        decision: "workspace",
        question: `Create a new workspace "${name}" for ${path}, or link the repo to an existing workspace?`,
        options: [
          "create_workspace",
          ...(unlinkedWorkspaces.length ? ["link_existing (see existing_unlinked_workspaces)"] : []),
        ],
      },
    ];
    if (optional.length) {
      decisions.push({
        decision: "rulesets",
        question: "Which optional rulesets should apply? Required rulesets are already included.",
        options: optional.map((r) => r.id),
      });
    }
    if (!match.repo.default_branch) {
      decisions.push({
        decision: "branch",
        question: "Which branch should be linked? The provider reported no default branch, so the repo may be empty.",
        options: [],
      });
    }

    return {
      status: "ready",
      repo: {
        ...repo,
        path: match.repo.path,
        owner,
        name,
        default_branch: match.repo.default_branch,
        web_url: match.repo.web_url,
      },
      enterprise: { id: match.enterprise.id, name: match.enterprise.name, slug: match.enterprise.slug },
      connection: {
        id: match.connection.id,
        provider: match.connection.provider,
        host: match.connection.host,
        account: match.connection.account,
      },
      proposed: {
        action: "create_workspace",
        workspace_name: name,
        branch,
        ruleset_ids: required.map((r) => r.id),
      },
      rulesets: { required: required.map(summarize), optional: optional.map(summarize) },
      existing_unlinked_workspaces: unlinkedWorkspaces,
      decisions_needed: decisions,
      next:
        "Show the user this plan and ask them to answer each item in decisions_needed. Do not call " +
        `setup_workspace until they have. Then call setup_workspace with enterprise_id ${match.enterprise.id}, ` +
        `connection_id ${match.connection.id}, repo_path "${match.repo.path}", branch "${branch}", and either ` +
        "workspace_name + ruleset_ids or existing_workspace_id.",
    };
  },
};
