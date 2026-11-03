import type { ToolDef } from "./helpers.js";
import { branchReport, detectWorkspaceBranch } from "./branch-report.js";

/**
 * See TOOL_DESCRIPTIONS.list_workspace_rulesets in validation.ts for the
 * agent-facing description. With a branch (explicit, else the checked-out
 * branch of a checkout of this workspace's repo) every row carries
 * `evaluated_on_branch` from that branch's latest visible check, which is the
 * real answer to "what applies here" under automatic discovery. The result
 * says which branch was used or why none was.
 */
export const listWorkspaceRulesets: ToolDef = {
  name: "list_workspace_rulesets",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const detected = await detectWorkspaceBranch(ctx, a.workspace_id, a.branch, a.enterprise_id);
    const result = (await ctx.client.listWorkspaceRulesets(
      enterpriseId,
      a.workspace_id,
      detected.branch ?? undefined
    )) as Record<string, unknown>;
    return { ...result, ...branchReport(detected) };
  },
};
