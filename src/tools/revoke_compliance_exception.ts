import type { ToolDef } from "./helpers.js";

/** End the exception in force on a rule. */
export const revokeComplianceException: ToolDef = {
  name: "revoke_compliance_exception",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    await ctx.client.revokeComplianceException(enterpriseId, a.workspace_id, a.rule_id);
    return {
      rule_id: a.rule_id,
      state: "revoked",
      next:
        "The rule is enforced again on this workspace. If the code still violates it, open pull " +
        "requests will fail the compliance check.",
    };
  },
};
