import type { ToolDef } from "./helpers.js";

export const getModuleDetails: ToolDef = {
  name: "get_module_details",
  run: ({ client }, a) => client.getModuleDetails(a.enterprise_id, a.module_id, a.version),
};
