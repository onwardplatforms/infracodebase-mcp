import type { ToolDef } from "./helpers.js";

export const revokeComplianceException: ToolDef = {
  name: "revoke_compliance_exception",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    await ctx.client.revokeComplianceException(enterpriseId, a.workspace_id, a.rule_id);
    return { rule_id: a.rule_id, state: "revoked" };
  },
};
