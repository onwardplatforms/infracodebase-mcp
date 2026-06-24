import type { ToolDef } from "./helpers.js";

/** Per-rule findings from a compliance evaluation. */
export const listComplianceFindings: ToolDef = {
  name: "list_compliance_findings",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return ctx.client.listComplianceFindings(enterpriseId, a.workspace_id, {
      ref: a.ref,
      status: a.status,
    });
  },
};
