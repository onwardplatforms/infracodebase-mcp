import type { ToolDef } from "./helpers.js";

export const listModuleConsumers: ToolDef = {
  name: "list_module_consumers",
  async run(ctx, {module_id, enterprise_id, ...query}) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(module_id, enterprise_id);
    return ctx.client.listModuleConsumers(enterpriseId, module_id, query);
  },
};
