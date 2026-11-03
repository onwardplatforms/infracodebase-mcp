import type { ToolDef } from "./helpers.js";

export const submitComplianceExceptions: ToolDef = {
  name: "submit_compliance_exceptions",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const results: Array<{ rule_id: string; result?: unknown; error?: string }> = [];

    // Submit serially so the result identifies exactly which requests succeeded
    // if the server rejects one of a batch for policy or permission reasons.
    for (const exception of a.exceptions) {
      try {
        results.push({
          rule_id: exception.rule_id,
          result: await ctx.client.submitComplianceException(enterpriseId, a.workspace_id, {
            ...exception,
            mode: a.mode,
          }),
        });
      } catch (error) {
        results.push({
          rule_id: exception.rule_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      mode: a.mode,
      results,
      next:
        a.mode === "request"
          ? "Requested exceptions do not affect compliance until an approver accepts them."
          : "Granted exceptions take effect immediately.",
    };
  },
};
