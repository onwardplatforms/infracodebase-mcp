import type { BranchDetection } from "../repo-detect.js";
import type { ToolContext } from "./helpers.js";

/**
 * The branch to ask about for a known workspace: an explicit argument, else
 * the checked-out branch of a checkout whose remote is this workspace's repo.
 * The enterprise hint, when the caller has one, keeps the repo lookup to a
 * single request.
 */
export async function detectWorkspaceBranch(
  ctx: ToolContext,
  workspaceId: string,
  explicit?: string,
  enterpriseHint?: string
): Promise<BranchDetection> {
  if (explicit) return { branch: explicit, resolved_from: "argument" };
  return ctx.resolveBranch(undefined, {
    repo: await ctx.getWorkspaceRepo(workspaceId, enterpriseHint),
  });
}

const BRANCH_NOTES = {
  other_repo:
    "The checked-out repo here is not this workspace's repo, so no branch was sent; the answer is for the workspace's default branch. Pass branch to ask about a specific branch.",
  no_checkout:
    "No checked-out branch was detected (not a git checkout, detached HEAD, or git unavailable), so the answer is for the workspace's default branch. Pass branch to ask about a specific branch.",
  repo_unknown:
    "This workspace has no linked repo on record (or it could not be read), so no checkout was matched and no branch was sent; the answer is for the workspace's default branch. Pass branch to ask about a specific branch.",
};

/**
 * What a tool result says about the branch it answered for. An explicit
 * argument is not echoed (the caller already knows it); a detected branch is
 * named with its source; no branch says why, and that the server answered for
 * the workspace's default branch instead.
 */
export function branchReport(detected: BranchDetection): Record<string, unknown> {
  if (detected.branch === null)
    return {
      branch_detection: detected.reason,
      branch_note: BRANCH_NOTES[detected.reason],
    };
  if (detected.resolved_from === "argument") return {};
  return { resolved_branch: detected.branch, branch_resolved_from: detected.resolved_from };
}
