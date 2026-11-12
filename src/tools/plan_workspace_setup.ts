import type { InfracodebaseClient } from "../client.js";
import type { ToolDef } from "./helpers.js";

/**
 * One read-only call that replaces the five lookups an agent used to chain
 * (list_enterprises, list_vcs_connections, list_vcs_repos, list_workspaces,
 * list_enterprise_resources) before it could set a repo up. It resolves the
 * repo, searches every enterprise's connections for it, and returns either a
 * `proposed` plan with the decisions the user still owns, or a status saying
 * what blocked it. It never writes: `setup_workspace` applies the plan once
 * the user has confirmed.
 *
 * When the repo does not exist yet (no git remote, or no connection can see
 * it) the answer lists the connected accounts it could be created under, and
 * for each one whether infracodebase can create it there as the user
 * (`setup_workspace` with `create_repo`) or whether the user must create it
 * with their own provider credentials first. A repository is never created
 * with the enterprise connection: that credential is broader than any one
 * member, so it would let a person create what the provider refuses them.
 */

interface Enterprise {
  id: string;
  name?: string;
  slug?: string;
}
type CreationStatus =
  | "available"
  | "connect_github_account"
  | "not_permitted"
  | "unsupported_provider"
  | "user_context_required";
interface Connection {
  id: string;
  provider?: string;
  host?: string;
  account?: string;
  account_type?: string | null;
  /** Absent on a server that predates repository creation through the API. */
  repository_creation?: CreationStatus;
  allowed_visibilities?: string[];
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
interface Target {
  enterprise_id: string;
  enterprise?: string;
  connection_id: string;
  provider?: string;
  host?: string;
  account?: string;
  account_type?: string | null;
  repository_creation: CreationStatus;
  allowed_visibilities: string[];
  create:
    | { how: "setup_workspace"; instructions: string }
    | { how: "provider"; command?: string; instructions: string };
}
interface Decision {
  decision: string;
  question: string;
  options: unknown[];
}

const rows = <T>(res: unknown): T[] => (res as { data?: T[] } | undefined)?.data ?? [];
const sameIgnoringCase = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  "azure-devops": "Azure DevOps",
  bitbucket: "Bitbucket",
};
const providerLabel = (provider?: string) =>
  (provider && PROVIDER_LABELS[provider]) || provider || "the provider";

/**
 * The command that creates the repository under `account` with the user's
 * own provider credentials, for the providers that have a CLI. Bitbucket has
 * no first-party CLI, so it gets prose instead of a command.
 */
function localCreateCommand(connection: Connection, name: string): string | undefined {
  const account = connection.account ?? "<account>";
  switch (connection.provider) {
    case "github":
      return `gh repo create ${account}/${name} --private`;
    case "gitlab":
      return `glab repo create ${account}/${name} --private`;
    case "azure-devops": {
      const [org, project] = account.split("/");
      return `az repos create --name ${name} --organization https://dev.azure.com/${org} --project ${project ?? "<project>"}`;
    }
    default:
      return undefined;
  }
}

const PUSH_THEN_PLAN_AGAIN =
  "push an initial commit, then call plan_workspace_setup again with repo_url set to the new repository.";

/** What the agent should do to get a repository under this connection. */
function creationGuidance(
  enterprise: Enterprise,
  connection: Connection,
  status: CreationStatus,
  name: string
): Target["create"] {
  const label = providerLabel(connection.provider);
  const account = connection.account ?? "the connected account";
  const command = localCreateCommand(connection, name);
  const locally = command
    ? `create it with the user's own ${label} credentials (${command}), ${PUSH_THEN_PLAN_AGAIN}`
    : `create it under ${account} in ${label} with the user's own credentials (web UI or REST API; there is no first-party CLI), ${PUSH_THEN_PLAN_AGAIN}`;
  switch (status) {
    case "available":
      return {
        how: "setup_workspace",
        instructions:
          `infracodebase can create this repository on ${label} under ${account} with the user's own connected account. ` +
          `Call setup_workspace with create_repo true, repo_name "${name}", enterprise_id ${enterprise.id}, ` +
          `connection_id ${connection.id}, and either workspace_name + ruleset_ids or existing_workspace_id.`,
      };
    case "connect_github_account":
      return {
        how: "provider",
        command,
        instructions:
          `infracodebase can create this repository on ${label} under ${account}, but only with the user's own ` +
          `${label} account, which they have not connected. Tell them: connect it in infracodebase under ` +
          `Settings → Connections and call plan_workspace_setup again, or ${locally}`,
      };
    case "not_permitted":
      return {
        how: "provider",
        command,
        instructions:
          `The user may not create repositories in enterprise ${enterprise.name ?? enterprise.id} ` +
          `(the integrations permission). Ask an enterprise admin to grant it, or ${locally}`,
      };
    case "user_context_required":
      return {
        how: "provider",
        command,
        instructions:
          `This token is an enterprise access token, which has no person to create a repository as. ` +
          `Use a personal token, or ${locally}`,
      };
    default:
      return {
        how: "provider",
        command,
        instructions:
          `infracodebase cannot create repositories on ${label} as the user yet, and it never creates ` +
          `them with the enterprise connection. Tell the user to ${locally}`,
      };
  }
}

function toTarget(enterprise: Enterprise, connection: Connection, name: string): Target {
  // A server without the field predates creation through the API: the only
  // path is the provider, whatever the provider.
  const status = connection.repository_creation ?? "unsupported_provider";
  return {
    enterprise_id: enterprise.id,
    enterprise: enterprise.name,
    connection_id: connection.id,
    provider: connection.provider,
    host: connection.host,
    account: connection.account,
    account_type: connection.account_type,
    repository_creation: status,
    allowed_visibilities: connection.allowed_visibilities ?? ["private"],
    create: creationGuidance(enterprise, connection, status, name),
  };
}

const summarizeResource = (r: Resource) => ({ id: r.id, name: r.name, description: r.description });

/** The enterprise facts every plan needs: its rulesets and its unlinked workspaces. */
async function enterprisePlanParts(client: InfracodebaseClient, enterpriseId: string) {
  const [workspaces, resources] = await Promise.all([
    client.listWorkspaces(enterpriseId, ["STANDARD", "TEMPLATE", "MODULE"]),
    client.listEnterpriseResources(enterpriseId),
  ]);
  const workspaceRows = rows<WorkspaceRow>(workspaces);
  const rulesets = (resources as { rulesets?: Resource[] } | undefined)?.rulesets ?? [];
  return {
    workspaceRows,
    unlinkedWorkspaces: workspaceRows
      .filter((w) => !w.linked_repository)
      .map(({ id, name, slug, description }) => ({ id, name, slug, description }))
      .slice(0, 10),
    required: rulesets.filter((r) => r.required),
    optional: rulesets.filter((r) => !r.required),
  };
}

function workspaceDecision(name: string, path: string, unlinked: unknown[]): Decision {
  return {
    decision: "workspace",
    question: `Create a new workspace "${name}" for ${path}, or link the repo to an existing workspace?`,
    options: [
      "create_workspace",
      ...(unlinked.length ? ["link_existing (see existing_unlinked_workspaces)"] : []),
    ],
  };
}

function rulesetsDecision(optional: Resource[]): Decision | null {
  if (!optional.length) return null;
  return {
    decision: "rulesets",
    question: "Which optional rulesets should apply? Required rulesets are already included.",
    options: optional.map((r) => r.id),
  };
}

/**
 * The answer when the repository does not exist yet: every connected account
 * it could live under, and the plan when exactly one is chosen and
 * infracodebase can create there as the user.
 */
async function missingRepoPlan(
  client: InfracodebaseClient,
  args: {
    status: "no_remote" | "repo_not_found";
    repo: Record<string, unknown>;
    repoName: string | undefined;
    scope: Array<{ enterprise: Enterprise; connections: Connection[] }>;
    extra?: Record<string, unknown>;
  }
) {
  const { status, repo, repoName, scope, extra } = args;
  const name = repoName ?? "<name>";
  const targets = scope.flatMap(({ enterprise, connections }) =>
    connections.map((c) => toTarget(enterprise, c, name))
  );
  const base = { status, repo, ...extra, targets };
  const why =
    status === "no_remote"
      ? "This directory has no git remote, so a repository has to be created first."
      : "No version-control connection can see this repository, so it may not exist yet (or the connection lacks access to it: check `similar`).";

  if (targets.length === 0) {
    return {
      ...base,
      next:
        `${why} No version-control connection is available to create it under. Ask an enterprise admin ` +
        "to connect a provider in Settings → Version control, or create the repository in the provider, " +
        PUSH_THEN_PLAN_AGAIN,
    };
  }

  if (targets.length > 1) {
    return {
      ...base,
      decisions_needed: [
        {
          decision: "target",
          question: `Where should ${repoName ? `the repository "${repoName}"` : "the new repository"} live?`,
          options: targets.map((t) => ({
            enterprise_id: t.enterprise_id,
            enterprise: t.enterprise,
            connection_id: t.connection_id,
            provider: t.provider,
            account: t.account,
            repository_creation: t.repository_creation,
          })),
        },
      ],
      next:
        `${why} Ask the user which connected account it should live under (a target whose ` +
        "repository_creation is `available` is one infracodebase can create itself, as the user). Then call " +
        "plan_workspace_setup again with that enterprise_id and connection_id, plus repo_name.",
    };
  }

  const [target] = targets;
  if (target.repository_creation !== "available") {
    return { ...base, target, next: `${why} ${target.create.instructions}` };
  }

  const enterprise = scope.find((s) => s.enterprise.id === target.enterprise_id)!.enterprise;
  const parts = await enterprisePlanParts(client, enterprise.id);
  const visibility = target.allowed_visibilities[0] ?? "private";
  const path = `${target.account ?? "<account>"}/${name}`;
  const decisions: Decision[] = [];
  if (!repoName) {
    decisions.push({
      decision: "repository_name",
      question: `What should the new repository under ${target.account} be called?`,
      options: [],
    });
  }
  if (target.allowed_visibilities.length > 1) {
    decisions.push({
      decision: "visibility",
      question: "Which visibility should the repository have?",
      options: target.allowed_visibilities,
    });
  }
  decisions.push(workspaceDecision(name, path, parts.unlinkedWorkspaces));
  const rulesets = rulesetsDecision(parts.optional);
  if (rulesets) decisions.push(rulesets);

  return {
    ...base,
    target,
    enterprise: { id: enterprise.id, name: enterprise.name, slug: enterprise.slug },
    connection: {
      id: target.connection_id,
      provider: target.provider,
      host: target.host,
      account: target.account,
    },
    proposed: {
      action: "create_repository_and_workspace",
      repo_name: repoName,
      visibility,
      workspace_name: repoName,
      ruleset_ids: parts.required.map((r) => r.id),
    },
    rulesets: {
      required: parts.required.map(summarizeResource),
      optional: parts.optional.map(summarizeResource),
    },
    existing_unlinked_workspaces: parts.unlinkedWorkspaces,
    decisions_needed: decisions,
    next:
      `${why} infracodebase can create it on ${providerLabel(target.provider)} under ${target.account} with the ` +
      "user's own connected account. Show the user this plan and ask them to answer each item in " +
      "decisions_needed. Do not call setup_workspace until they have. Then call setup_workspace with " +
      `create_repo true, repo_name, visibility, enterprise_id ${enterprise.id}, connection_id ` +
      `${target.connection_id}, and either workspace_name + ruleset_ids or existing_workspace_id. It ` +
      "creates the repository, links it, and returns the clone URL to add as the git remote.",
  };
}

export const planWorkspaceSetup: ToolDef = {
  name: "plan_workspace_setup",
  async run(ctx, a) {
    const { client } = ctx;

    // The enterprises and connections in scope: needed to find an existing
    // repo and to say where a new one could live, but not for a repo that is
    // already governed, so loaded only once a path needs them.
    const loadScope = async () => {
      const enterprises = rows<Enterprise>(await client.listEnterprises());
      const enterpriseScope = a.enterprise_id
        ? enterprises.filter((e) => e.id === a.enterprise_id)
        : enterprises;
      if (a.enterprise_id && enterpriseScope.length === 0) {
        throw new Error(
          `enterprise_id ${a.enterprise_id} is not an enterprise this token can access. Call list_enterprises.`
        );
      }
      if (enterpriseScope.length === 0) {
        throw new Error(
          "This token belongs to no enterprise. Ask an enterprise admin for an invitation before setting up a repo."
        );
      }
      return Promise.all(
        enterpriseScope.map(async (enterprise) => {
          let connections = rows<Connection>(await client.listVcsConnections(enterprise.id));
          if (a.connection_id) connections = connections.filter((c) => c.id === a.connection_id);
          return { enterprise, connections };
        })
      );
    };

    let detected;
    try {
      detected = await ctx.resolveRepoUrl(a.repo_url);
    } catch (err) {
      if (a.repo_url) throw err;
      // Nothing to look for: the repository has to be created before it can
      // be governed. Say where it could live.
      return missingRepoPlan(client, {
        status: "no_remote",
        repo: {
          url: null,
          resolved_from: null,
          detail: err instanceof Error ? err.message : String(err),
        },
        repoName: a.repo_name,
        scope: await loadScope(),
      });
    }
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
    const scope = await loadScope();

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
      scope.map(async ({ enterprise, connections }) => {
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
      // The remote names a repo nobody can see. It probably does not exist
      // yet: offer the same create targets as an empty directory gets, and
      // default the name to the remote's.
      return missingRepoPlan(client, {
        status: "repo_not_found",
        repo: { ...repo, path, owner, name },
        repoName: a.repo_name ?? (name || undefined),
        scope,
        extra: { scanned, similar: similar.slice(0, 5) },
      });
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
    const parts = await enterprisePlanParts(client, match.enterprise.id);

    const owning = parts.workspaceRows.find(
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

    const branch = match.repo.default_branch || "main";
    const decisions: Decision[] = [workspaceDecision(name, path, parts.unlinkedWorkspaces)];
    const rulesets = rulesetsDecision(parts.optional);
    if (rulesets) decisions.push(rulesets);
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
        ruleset_ids: parts.required.map((r) => r.id),
      },
      rulesets: {
        required: parts.required.map(summarizeResource),
        optional: parts.optional.map(summarizeResource),
      },
      existing_unlinked_workspaces: parts.unlinkedWorkspaces,
      decisions_needed: decisions,
      next:
        "Show the user this plan and ask them to answer each item in decisions_needed. Do not call " +
        `setup_workspace until they have. Then call setup_workspace with enterprise_id ${match.enterprise.id}, ` +
        `connection_id ${match.connection.id}, repo_path "${match.repo.path}", branch "${branch}", and either ` +
        "workspace_name + ruleset_ids or existing_workspace_id.",
    };
  },
};
