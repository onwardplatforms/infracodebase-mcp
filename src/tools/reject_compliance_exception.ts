import type { ToolDef } from "./helpers.js";

export const rejectComplianceException: ToolDef = {
  name: "reject_compliance_exception",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    await ctx.client.rejectComplianceException(enterpriseId, a.workspace_id, a.rule_id, a.reason);
    return { rule_id: a.rule_id, state: "rejected" };
  },
};
