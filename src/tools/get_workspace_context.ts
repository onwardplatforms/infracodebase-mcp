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

/**
 * Full workspace context, resolved from an explicit workspace_id, an explicit
 * repo_url, or (with no arguments) the repo the agent is working in. Response
 * `status` is one of `linked`, `unlinked` (no workspace matches), `no_access`
 * (a workspace exists but the caller can't see it), or `ambiguous` (the repo
 * matches workspaces in more than one enterprise the caller can see).
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

    const repo = await ctx.resolveRepoUrl(a.repo_url);
    const detected = await detectRepoBranch(ctx, repo, a.branch);
    const result = await ctx.client.resolveWorkspaceContext({
      repoUrl: repo.repo_url,
      workspaceId: undefined,
      iacTool: a.iac_tool,
      branch: detected.branch ?? undefined,
    });
    // Auto-detection is reported, never silent, so the agent and the user can
    // see which repo and branch the answer is about.
    return withBranch(
      {
        ...(result as Record<string, unknown>),
        ...(repo.resolved_from === "argument"
          ? {}
          : { resolved_repo_url: repo.repo_url, resolved_from: repo.resolved_from }),
      },
      detected
    );
  },
};

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
