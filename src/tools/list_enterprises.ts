import type { ToolDef } from "./helpers.js";

/** List enterprises the caller belongs to. */
export const listEnterprises: ToolDef = {
  name: "list_enterprises",
  run: ({ client }) => client.listEnterprises(),
};
