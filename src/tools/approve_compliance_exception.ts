import type { ToolDef } from "./helpers.js";

export const APPROVED_NEXT =
  "The exception is in force now for the whole workspace. The rule stops counting against the " +
  "score until it is revoked or expires, and checks on open pull requests are refreshed. Tell " +
  "the user exactly that.";

/** Approve the open exception request on a rule. */
export const approveComplianceException: ToolDef = {
  name: "approve_compliance_exception",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    await ctx.client.approveComplianceException(enterpriseId, a.workspace_id, a.rule_id);
    return { rule_id: a.rule_id, state: "active", next: APPROVED_NEXT };
  },
};
