import type { BranchDetection } from "../repo-detect.js";
import type { ToolContext } from "./helpers.js";

/**
 * The branch to ask about for a known workspace: an explicit argument, else
 * the checked-out branch of a checkout whose remote is this workspace's repo.
 */
export async function detectWorkspaceBranch(
  ctx: ToolContext,
  workspaceId: string,
  explicit?: string
): Promise<BranchDetection> {
  return ctx.resolveBranch(explicit, { repo: await ctx.getWorkspaceRepo(workspaceId) });
}

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
      branch_note:
        detected.reason === "other_repo"
          ? "The checked-out repo here is not this workspace's repo, so no branch was sent; the answer is for the workspace's default branch. Pass branch to ask about a specific branch."
          : "No checked-out branch was detected (not a git checkout, detached HEAD, or git unavailable), so the answer is for the workspace's default branch. Pass branch to ask about a specific branch.",
    };
  if (detected.resolved_from === "argument") return {};
  return { resolved_branch: detected.branch, branch_resolved_from: detected.resolved_from };
}
