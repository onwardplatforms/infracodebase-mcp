import type { ToolDef } from "./helpers.js";

export const listWorkspaceModules: ToolDef = {
  name: "list_workspace_modules",
  async run(ctx, {workspace_id, enterprise_id, ...query}) {
    const enterpriseId = await ctx.getEnterpriseForWorkspace(workspace_id, enterprise_id);
    return ctx.client.listWorkspaceModules(enterpriseId, workspace_id, query);
  },
};
