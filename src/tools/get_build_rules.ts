import type { ToolDef } from "./helpers.js";

/**
 * Rules of the optional rulesets the agent selected from an unlinked
 * context's `available_rulesets`, read without reloading the whole context.
 * Required rulesets are already in that context, so only the selected ones
 * come back. The response's `setup` carries the required plus selected ids
 * for setup_workspace once the repo is ready to link.
 */
export const getBuildRules: ToolDef = {
  name: "get_build_rules",
  run: ({ client }, a) => client.getBuildRules(a.enterprise_id, a.ruleset_ids ?? []),
};
