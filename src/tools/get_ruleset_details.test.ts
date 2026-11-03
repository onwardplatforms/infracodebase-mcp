import { describe, it, expect, vi } from "vitest";
import { getRulesetDetails } from "./get_ruleset_details.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_ruleset_details", () => {
  it("resolves the enterprise and fetches the ruleset by id", async () => {
    const client = mockClient({ getRulesetDetails: vi.fn().mockResolvedValue({ rules: [] }) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await getRulesetDetails.run(ctx, { workspace_id: "ws_1", ruleset_id: "rs_1" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.getRulesetDetails).toHaveBeenCalledWith("ent_1", "rs_1");
  });

  it("returns the client's response verbatim, including each rule's enabled flag", async () => {
    const client = mockClient({
      getRulesetDetails: vi.fn().mockResolvedValue({
        id: "rs_1",
        rules: [
          { id: "rule_1", title: "Active rule", enabled: true },
          { id: "rule_2", title: "Disabled rule", enabled: false },
        ],
      }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await getRulesetDetails.run(ctx, { workspace_id: "ws_1", ruleset_id: "rs_1" });

    expect(result).toEqual({
      id: "rs_1",
      rules: [
        { id: "rule_1", title: "Active rule", enabled: true },
        { id: "rule_2", title: "Disabled rule", enabled: false },
      ],
    });
  });
});

describe("get_ruleset_details detail levels", () => {
  const ctxWith = (rules: unknown[]) =>
    mockContext({
      client: mockClient({
        getRulesetDetails: vi.fn().mockResolvedValue({ id: "rs_1", title: "Storage", rules }),
      }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
    });

  it("drops each rule's content in summary detail and keeps the ruleset fields", async () => {
    const ctx = ctxWith([
      {
        id: "rule_1",
        title: "Encrypt at rest",
        content: "# long body",
        required: true,
        enabled: true,
      },
    ]);

    const result = await getRulesetDetails.run(ctx, {
      workspace_id: "ws_1",
      ruleset_id: "rs_1",
      detail: "summary",
    });

    expect(result).toEqual({
      id: "rs_1",
      title: "Storage",
      detail: "summary",
      rules: [{ id: "rule_1", title: "Encrypt at rest", required: true, enabled: true }],
    });
  });

  it("keeps rule content in full detail", async () => {
    const ctx = ctxWith([{ id: "rule_1", content: "# long body" }]);

    const result = (await getRulesetDetails.run(ctx, {
      workspace_id: "ws_1",
      ruleset_id: "rs_1",
      detail: "full",
    })) as { rules: Array<{ content?: string }>; detail?: string };

    expect(result.rules[0].content).toBe("# long body");
    expect(result).not.toHaveProperty("detail");
  });
});
