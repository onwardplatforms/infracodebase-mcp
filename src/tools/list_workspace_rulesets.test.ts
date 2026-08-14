import { describe, it, expect, vi } from "vitest";
import { listWorkspaceRulesets } from "./list_workspace_rulesets.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_workspace_rulesets", () => {
  it("resolves the enterprise and fetches the workspace's full ruleset list", async () => {
    const client = mockClient({ listWorkspaceRulesets: vi.fn().mockResolvedValue({ data: [] }) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await listWorkspaceRulesets.run(ctx, { workspace_id: "ws_1" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.listWorkspaceRulesets).toHaveBeenCalledWith("ent_1", "ws_1");
  });

  it("returns the client's response verbatim, including unattached rulesets", async () => {
    const client = mockClient({
      listWorkspaceRulesets: vi.fn().mockResolvedValue({
        data: [
          { id: "rs_1", title: "Attached ruleset", effective_enabled: true, workspace_setting: null },
          {
            id: "rs_2",
            title: "Available but unattached",
            effective_enabled: false,
            workspace_setting: null,
          },
        ],
      }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await listWorkspaceRulesets.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({
      data: [
        { id: "rs_1", title: "Attached ruleset", effective_enabled: true, workspace_setting: null },
        {
          id: "rs_2",
          title: "Available but unattached",
          effective_enabled: false,
          workspace_setting: null,
        },
      ],
    });
  });
});
