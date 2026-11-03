import type { BranchDetection, NoBranchReason } from "../repo-detect.js";
import { WrongEnterpriseError, type ToolContext } from "./helpers.js";

/**
 * The branch to ask about for a known workspace: an explicit branch, else the
 * checked-out branch of a checkout whose remote is this workspace's repo. An
 * explicit branch skips the repo lookup. The enterprise id, when the caller
 * has one, keeps that lookup to a single request.
 *
 * The lookup is best effort: the tool's own request does not need it, so a
 * failure there (a rate limit, an outage, an enterprise that could not be
 * listed) degrades to `repo_unknown` with the cause in the note rather than
 * failing the tool. The one exception is a wrong enterprise id, which would
 * fail the tool's own request anyway, so it is raised with a clear message.
 */
export async function detectWorkspaceBranch(
  ctx: ToolContext,
  workspaceId: string,
  options: { branch?: string; enterpriseId?: string }
): Promise<BranchDetection> {
  if (options.branch) return { branch: options.branch, resolved_from: "argument" };
  let repo;
  try {
    repo = await ctx.getWorkspaceRepo(workspaceId, options.enterpriseId);
  } catch (err) {
    if (err instanceof WrongEnterpriseError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[infracodebase-mcp] could not look up the repo of ${workspaceId}: ${detail}`);
    return { branch: null, reason: "repo_unknown", detail };
  }
  return ctx.resolveBranch(undefined, { repo });
}

const BRANCH_NOTES: Record<NoBranchReason, string> = {
  other_repo:
    "The checked-out repo here is not this workspace's repo, so no branch was sent; the answer is for the workspace's default branch. Pass branch to ask about a specific branch.",
  no_checkout:
    "No checked-out branch was detected (not a git checkout, detached HEAD, or git unavailable), so the answer is for the workspace's default branch. Pass branch to ask about a specific branch.",
  repo_unknown:
    "This workspace's repo could not be determined (none on record, not among the first 100 workspaces of its enterprise, or the lookup failed), so no checkout was matched and no branch was sent; the answer is for the workspace's default branch. Pass enterprise_id so the workspace is fetched directly, or pass branch.",
  unparsed_repo_url:
    "repo_url could not be parsed as a git remote, so no checkout was matched and no branch was sent; the answer is for the workspace's default branch. Pass the output of `git remote get-url origin`, or pass branch.",
};

/**
 * What a tool result says about the branch it answered for. An explicit
 * argument is not echoed (the caller already knows it); a detected branch is
 * named with its source; no branch says why, and that the server answered for
 * the workspace's default branch instead. A detail from detection (the error
 * that stopped it) is appended so the agent can decide to retry.
 */
export function branchReport(detected: BranchDetection): Record<string, unknown> {
  if (detected.branch === null)
    return {
      branch_detection: detected.reason,
      branch_note: detected.detail
        ? `${BRANCH_NOTES[detected.reason]} Detection stopped on: ${detected.detail}`
        : BRANCH_NOTES[detected.reason],
    };
  if (detected.resolved_from === "argument") return {};
  return { resolved_branch: detected.branch, branch_resolved_from: detected.resolved_from };
}
