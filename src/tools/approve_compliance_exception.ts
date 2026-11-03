import type { ToolDef } from "./helpers.js";

export const approveComplianceException: ToolDef = {
  name: "approve_compliance_exception",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    await ctx.client.approveComplianceException(enterpriseId, a.workspace_id, a.rule_id);
    return { rule_id: a.rule_id, state: "active" };
  },
};
