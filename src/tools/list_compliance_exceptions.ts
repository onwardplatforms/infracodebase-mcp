import type { ToolDef } from "./helpers.js";

export const listComplianceExceptions: ToolDef = {
  name: "list_compliance_exceptions",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.listComplianceExceptions(enterpriseId, a.workspace_id);
  },
};
