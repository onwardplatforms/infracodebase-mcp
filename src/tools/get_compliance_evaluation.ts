import type { ToolDef } from "./helpers.js";

/** Statuses the API uses for an evaluation that has not finished yet. */
const IN_FLIGHT = new Set(["queued", "pending", "running", "in_progress"]);

export const RUNNING_NEXT =
  "Still running. Share `url` with the user instead of polling; check again only when they ask.";

/**
 * Summary of a compliance evaluation; latest when no ref is given. `branch`
 * scopes "latest" to that branch (server falls back to the workspace's
 * default branch, then to the most recent completed evaluation on any
 * branch); ignored when `ref` is given. An unfinished evaluation carries a
 * `next` field so the agent does not turn this into a polling loop.
 */
export const getComplianceEvaluation: ToolDef = {
  name: "get_compliance_evaluation",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const result = (await ctx.client.getComplianceEvaluation(
      enterpriseId,
      a.workspace_id,
      a.ref,
      a.branch
    )) as Record<string, unknown> & { status?: string };

    return result.status && IN_FLIGHT.has(result.status) ? { ...result, next: RUNNING_NEXT } : result;
  },
};
