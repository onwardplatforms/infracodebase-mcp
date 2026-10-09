import type { ToolDef } from "./helpers.js";

/** Reject the open exception request on a rule. */
export const rejectComplianceException: ToolDef = {
  name: "reject_compliance_exception",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    await ctx.client.rejectComplianceException(enterpriseId, a.workspace_id, a.rule_id, a.reason);
    return {
      rule_id: a.rule_id,
      state: "rejected",
      next:
        "The request is closed. Any exception already in force on the rule is unchanged. The " +
        "requester sees your reason.",
    };
  },
};
