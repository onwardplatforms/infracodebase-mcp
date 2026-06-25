import type { ToolDef } from "./helpers.js";

/** The enterprise's approved reusable infrastructure modules. */
export const listModules: ToolDef = {
  name: "list_modules",
  run: ({ client }, a) => client.listModules(a.enterprise_id),
};
