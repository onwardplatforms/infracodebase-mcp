import type { ToolDef } from "./helpers.js";

/** Rulesets, MCP servers, and workflows available in an enterprise. */
export const listEnterpriseResources: ToolDef = {
  name: "list_enterprise_resources",
  run: ({ client }, a) => client.listEnterpriseResources(a.enterprise_id),
};
