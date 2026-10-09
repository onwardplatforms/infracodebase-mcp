import type { ToolDef } from "./helpers.js";

/** Active exceptions and open requests for a workspace. */
export const listComplianceExceptions: ToolDef = {
  name: "list_compliance_exceptions",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const { data } = await ctx.client.listComplianceExceptions(enterpriseId, a.workspace_id);
    return { exceptions: data };
  },
};
