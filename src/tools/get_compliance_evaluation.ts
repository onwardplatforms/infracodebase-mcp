import { ApiError } from "../client.js";
import type { ToolDef } from "./helpers.js";
import { branchReport, detectWorkspaceBranch } from "./branch-report.js";

/** Statuses the API uses for an evaluation that has not finished yet. */
const IN_FLIGHT = new Set(["queued", "pending", "running", "in_progress"]);

type EvaluationResult = Record<string, unknown> & { status?: string };

/** The 404 that means "no evaluation", as opposed to a wrong workspace or enterprise. Older servers send no code. */
function isNoEvaluation(err: ApiError) {
  return err.code === undefined || err.code === "evaluation_not_found";
}

export const RUNNING_NEXT =
  "Still running. Share `url` with the user instead of polling; check again only when they ask.";

/**
 * Summary of a compliance evaluation; latest when no ref is given. "Latest"
 * means latest on the branch the agent is working on: an explicit `branch`,
 * else the checked-out branch of a checkout of this workspace's repo. A
 * pinned branch with no completed check returns `found: false` with the branch
 * named; no other branch is substituted. Only when no branch is known at all
 * does the server fall back to the default branch, then any branch. An
 * unfinished evaluation carries a `next` field so the agent does not turn
 * this into a polling loop.
 */
export const getComplianceEvaluation: ToolDef = {
  name: "get_compliance_evaluation",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    // A ref lookup is not branch-scoped, so never detect one for it.
    const detected = a.ref
      ? null
      : await detectWorkspaceBranch(ctx, a.workspace_id, a.branch, a.enterprise_id);
    const report = detected ? branchReport(detected) : {};
    const branch = detected?.branch ?? undefined;
    let result: EvaluationResult;
    try {
      result = (await ctx.client.getComplianceEvaluation(
        enterpriseId,
        a.workspace_id,
        a.ref,
        branch
      )) as EvaluationResult;
    } catch (err) {
      // The API answers "no evaluation" with a 404. On a branch that is a
      // normal state ("nothing checked here yet"), not an error, and the
      // agent must not read it as "this workspace has no evaluations". Any
      // other 404 (the workspace is not in this enterprise) is a real error.
      if (err instanceof ApiError && err.status === 404 && isNoEvaluation(err) && !a.ref && branch)
        return {
          found: false,
          branch,
          ...report,
          message: `No completed compliance evaluation is visible on ${branch}. Nothing has been checked on this branch yet, or its checks belong to Work conversations you are not in. This says nothing about other branches; pass branch to ask about one, or trigger an evaluation of this branch's pushed commit.`,
        };
      throw err;
    }

    return result.status && IN_FLIGHT.has(result.status)
      ? { ...result, ...report, next: RUNNING_NEXT }
      : { ...result, ...report };
  },
};
