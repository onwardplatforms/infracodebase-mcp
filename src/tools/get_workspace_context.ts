import { ApiError } from "../client.js";
import {
  parseRemoteRef,
  type BranchDetection,
  type ResolvedRepo,
} from "../repo-detect.js";
import type { ToolContext, ToolDef } from "./helpers.js";
import { branchReport, detectWorkspaceBranch } from "./branch-report.js";

/**
 * The branch for a repo-addressed lookup. A named repo_url has no checkout of
 * its own, so look for one whose remote is that repo. An auto-detected repo
 * already carries the branch of the directory it was read from, unless the
 * caller named one.
 */
async function detectRepoBranch(
  ctx: ToolContext,
  repo: ResolvedRepo,
  explicit?: string
): Promise<BranchDetection> {
  if (explicit) return { branch: explicit, resolved_from: "argument" };
  if (repo.resolved_from === "argument") {
    const named = repoFromUrl(repo.repo_url);
    // Nothing to match checkouts against: say so, rather than claiming the
    // workspace has no repo or trusting the first checkout.
    if (!named) return { branch: null, reason: "unparsed_repo_url" };
    return ctx.resolveBranch(undefined, { repo: named });
  }
  if (repo.branch) return { branch: repo.branch, resolved_from: repo.resolved_from };
  return { branch: null, reason: "no_checkout" };
}

/** What the agent does with an unlinked repo it can draft for. */
export const DRAFT_MESSAGE =
  "No workspace governs this repo yet, but you can draft now: write against `rulesets` (the " +
  "enterprise's required rules plus any selected optional ones) and `coding_guidelines`, and " +
  "prefer the modules listed. This is not a compliance evaluation of local code.";

/** The API wants the optional rulesets chosen before it will say can_generate. */
export const SELECTION_MESSAGE =
  "Before drafting, pick the optional rulesets relevant to the task from `available_rulesets` " +
  "(rule_titles summarize each) and call get_build_rules with setup.enterprise_id and the " +
  "chosen ruleset_ids (an empty list if none fit) to read their rules. Required rules are " +
  "already in `rulesets`.";

/** Appended to every unlinked answer: drafting is allowed, governance still needs the link. */
export const SETUP_OFFER =
  "Tell the user pushes will not be checked until the repo is linked, and offer to set it up " +
  "with plan_workspace_setup, then setup_workspace once they confirm; keep setup.enterprise_id " +
  "and setup.ruleset_ids for it.";

/** The caller belongs to several enterprises and none was named. */
export const NEEDS_ENTERPRISE_MESSAGE =
  "No workspace governs this repo and you belong to several enterprises. Ask the user which " +
  "one to draft for (see `enterprises`), then call get_workspace_context again with its " +
  "enterprise_id.";

type Json = Record<string, unknown>;

interface BuildContext extends Json {
  status: string;
  can_generate?: boolean;
  selection_required?: boolean;
  message?: string;
}

/** Selectors handed to build-context; one of repoUrl or nothing. */
interface DraftingSelectors {
  repoUrl?: string;
  enterpriseId?: string;
  rulesetIds?: string[];
  iacTool?: string;
  branch?: string;
}

/**
 * Full workspace context, resolved from an explicit workspace_id, an explicit
 * repo_url, or (with no arguments) the repo the agent is working in. Response
 * `status` is one of `linked`, `unlinked` (no workspace matches), `no_access`
 * (a workspace exists but the caller can't see it), `ambiguous` (the repo
 * matches workspaces in more than one enterprise the caller can see), or
 * `needs_enterprise` (unlinked, and the caller must name which enterprise to
 * draft for).
 *
 * An unlinked repo is not a dead end. The API's build-context answers with the
 * enterprise's required rulesets, guidelines, and modules, so the agent can
 * draft against them while setup is still an offer. The same applies when no
 * git remote exists yet (an empty repo): the enterprise context is returned
 * with `repo_detection` saying why no repo was resolved. Older servers without
 * build-context get the plain unlinked answer, or the detector's error.
 *
 * The branch matters: on a feature branch the rulesets and score come from
 * that branch's latest completed check, which under automatic discovery is
 * wider than the workspace's settings. An explicit `branch` wins. Otherwise
 * the checked-out branch is taken from a checkout of the same repo: the
 * directory the repo was auto-detected from, or, with workspace_id or
 * repo_url, a root or cwd whose remote is that repo. A linked result says
 * which branch was used or why none was; the other statuses have no
 * workspace to scope and carry no branch fields.
 */
export const getWorkspaceContext: ToolDef = {
  name: "get_workspace_context",
  async run(ctx, a) {
    if (a.workspace_id) {
      const detected = await detectWorkspaceBranch(ctx, a.workspace_id, {
        branch: a.branch,
        enterpriseId: a.enterprise_id,
      });
      const result = await ctx.client.resolveWorkspaceContext({
        repoUrl: undefined,
        workspaceId: a.workspace_id,
        iacTool: a.iac_tool,
        branch: detected.branch ?? undefined,
      });
      return withBranch(result, detected);
    }

    const selectors: DraftingSelectors = {
      enterpriseId: a.enterprise_id,
      rulesetIds: a.ruleset_ids,
      iacTool: a.iac_tool,
    };

    let repo: ResolvedRepo;
    try {
      repo = await ctx.resolveRepoUrl(a.repo_url);
    } catch (err) {
      // No remote to resolve: an empty repo, or a directory outside git. The
      // enterprise's drafting context still applies, so answer with that when
      // the server offers it. An older server gets the detector's error.
      const drafting = await buildContext(ctx, selectors);
      if (!drafting) throw err;
      return { ...withDraftingMessage(drafting), repo_detection: messageOf(err) };
    }

    const detected = await detectRepoBranch(ctx, repo, a.branch);
    const result = (await ctx.client.resolveWorkspaceContext({
      repoUrl: repo.repo_url,
      workspaceId: undefined,
      iacTool: a.iac_tool,
      branch: detected.branch ?? undefined,
    })) as Json;
    // Auto-detection is reported, never silent, so the agent and the user can
    // see which repo and branch the answer is about.
    const reported: Json = {
      ...result,
      ...(repo.resolved_from === "argument"
        ? {}
        : { resolved_repo_url: repo.repo_url, resolved_from: repo.resolved_from }),
    };
    if (reported.status !== "unlinked") return withBranch(reported, detected);

    const drafting = await buildContext(ctx, {
      ...selectors,
      repoUrl: repo.repo_url,
      branch: detected.branch ?? undefined,
    });
    return drafting ? mergeDrafting(reported, drafting) : reported;
  },
};

/**
 * The drafting context for an unlinked repo, or null when the server predates
 * build-context (404) so the caller can answer the way it always has. Other
 * failures (a ruleset not in the enterprise, an enterprise the caller is not a
 * member of) are the agent's to see.
 */
async function buildContext(
  ctx: ToolContext,
  selectors: DraftingSelectors
): Promise<BuildContext | null> {
  try {
    return (await ctx.client.getBuildContext(selectors)) as BuildContext;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Lay the drafting context over the unlinked answer. The unlinked fields
 * (owner, name, the setup hint) stay; build-context adds the rulesets,
 * guidelines, modules, `can_generate`, and the setup ids, and the message is
 * rewritten so it names this server's tools.
 */
function mergeDrafting(unlinked: Json, drafting: BuildContext): Json {
  if (drafting.status === "needs_enterprise") {
    return {
      ...unlinked,
      status: "needs_enterprise",
      can_generate: false,
      enterprises: drafting.enterprises,
      message: NEEDS_ENTERPRISE_MESSAGE,
    };
  }
  if (drafting.status !== "unlinked") {
    // No enterprise is accessible (no_access), or the two endpoints disagree.
    // Nothing to draft against: keep the unlinked answer and say why.
    return {
      ...unlinked,
      can_generate: false,
      message: [unlinked.message, drafting.message].filter(Boolean).join(" "),
    };
  }
  return withDraftingMessage({ ...unlinked, ...drafting });
}

/** The drafting answer with a message that names this server's tools. */
function withDraftingMessage(drafting: BuildContext): Json {
  if (drafting.status === "needs_enterprise") {
    return { ...drafting, message: NEEDS_ENTERPRISE_MESSAGE };
  }
  if (drafting.status !== "unlinked") return drafting;
  const lead = drafting.selection_required
    ? SELECTION_MESSAGE
    : drafting.can_generate
      ? DRAFT_MESSAGE
      : // The API said what is missing (usually the module catalog): keep it.
        (drafting.message ?? "");
  return { ...drafting, message: [lead, SETUP_OFFER].filter(Boolean).join(" ") };
}

/**
 * Only a linked answer is scoped to a branch. The other statuses have no
 * workspace to scope, and a note about "the workspace's default branch" there
 * would send the agent chasing a branch instead of following `message`.
 */
function withBranch(result: unknown, detected: BranchDetection): Record<string, unknown> {
  const r = result as Record<string, unknown>;
  return r.status === "linked" ? { ...r, ...branchReport(detected) } : r;
}

/** The explicit repo_url as a LinkedRepo, so branch detection only accepts a checkout of that repo. */
function repoFromUrl(repoUrl: string) {
  const parsed = parseRemoteRef(repoUrl);
  return parsed
    ? { owner: parsed.owner, name: parsed.name, host: parsed.host, display_path: parsed.displayPath }
    : null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
