import { describe, it, expect, vi } from "vitest";
import { getBuildRules } from "./get_build_rules.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_build_rules", () => {
  it("reads the selected rulesets for the enterprise and returns the API's answer", async () => {
    const response = {
      selection_complete: true,
      rulesets: [{ id: "rs_opt", title: "Tagging", rules: [] }],
      setup: { enterprise_id: "ent_1", ruleset_ids: ["rs_req", "rs_opt"] },
      message: "Use these selected rules with the required rules.",
    };
    const client = mockClient({ getBuildRules: vi.fn().mockResolvedValue(response) });

    const result = await getBuildRules.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      ruleset_ids: ["rs_opt"],
    });

    expect(client.getBuildRules).toHaveBeenCalledWith("ent_1", ["rs_opt"]);
    expect(result).toEqual(response);
  });

  it("selects no optional rulesets when ruleset_ids is omitted", async () => {
    const client = mockClient({ getBuildRules: vi.fn().mockResolvedValue({ rulesets: [] }) });

    await getBuildRules.run(mockContext({ client }), { enterprise_id: "ent_1" });

    expect(client.getBuildRules).toHaveBeenCalledWith("ent_1", []);
  });
});
