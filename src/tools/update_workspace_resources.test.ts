import { describe, it, expect, vi } from "vitest";
import { updateWorkspaceResources } from "./update_workspace_resources.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("update_workspace_resources", () => {
  it("resolves the enterprise then forwards every add/remove list", async () => {
    const client = mockClient({ updateWorkspaceResources: vi.fn().mockResolvedValue({}) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await updateWorkspaceResources.run(ctx, {
      workspace_id: "ws_1",
      add_ruleset_ids: ["rs_1"],
      remove_ruleset_ids: ["rs_2"],
      add_mcp_server_ids: ["mcp_1"],
      remove_mcp_server_ids: ["mcp_2"],
      add_workflow_ids: ["wf_1"],
      remove_workflow_ids: ["wf_2"],
    });

    expect(client.updateWorkspaceResources).toHaveBeenCalledWith("ent_1", "ws_1", {
      add_ruleset_ids: ["rs_1"],
      remove_ruleset_ids: ["rs_2"],
      add_mcp_server_ids: ["mcp_1"],
      remove_mcp_server_ids: ["mcp_2"],
      add_workflow_ids: ["wf_1"],
      remove_workflow_ids: ["wf_2"],
    });
  });
});
