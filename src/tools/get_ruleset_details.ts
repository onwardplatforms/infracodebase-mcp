import { omitFields, type ToolDef } from "./helpers.js";

/** The long field of a rule that `detail: "summary"` drops. */
const RULE_TEXT_FIELDS = ["content"] as const;

/** See TOOL_DESCRIPTIONS.get_ruleset_details in validation.ts for the agent-facing description. */
export const getRulesetDetails: ToolDef = {
  name: "get_ruleset_details",
  async run(ctx, a) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    const result = (await ctx.client.getRulesetDetails(enterpriseId, a.ruleset_id)) as {
      rules?: unknown[];
    } & Record<string, unknown>;
    if (a.detail !== "summary" || !Array.isArray(result.rules)) return result;
    return {
      ...result,
      detail: "summary",
      rules: result.rules.map((rule) => omitFields(rule, RULE_TEXT_FIELDS)),
    };
  },
};
