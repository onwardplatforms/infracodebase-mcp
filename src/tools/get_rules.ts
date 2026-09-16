import type { ToolDef } from "./helpers.js";

/** Fetch selected rules without repeating repository or module discovery. */
export const getRules: ToolDef = {
  name: "get_rules",
  async run({ client }, a) {
    return client.getBuildRules(a.enterprise_id, a.ruleset_ids);
  },
};
