import { describe, it, expect, vi } from "vitest";
import { getRules } from "./get_rules.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_rules", () => {
  it.each([{ rulesetIds: ["network", "iam"] }, { rulesetIds: [] }])(
    "reads selection $rulesetIds without reloading context or mutating a workspace",
    async ({ rulesetIds }) => {
      const response = {
        selection_complete: true,
        rulesets: [],
        setup: { enterprise_id: "team", ruleset_ids: ["required", ...rulesetIds] },
      };
      const client = mockClient({ getBuildRules: vi.fn().mockResolvedValue(response) });
      expect(
        await getRules.run(mockContext({ client }), {
          enterprise_id: "team",
          ruleset_ids: rulesetIds,
        })
      ).toEqual(response);
      expect(client.getBuildRules).toHaveBeenCalledExactlyOnceWith("team", rulesetIds);
      expect(client.getBuildContext).not.toHaveBeenCalled();
      expect(client.updateWorkspaceResources).not.toHaveBeenCalled();
    }
  );
  it("preserves rule-access errors", async () => {
    const client = mockClient({
      getBuildRules: vi.fn().mockRejectedValue(new Error("Rules unavailable")),
    });
    await expect(
      getRules.run(mockContext({ client }), { enterprise_id: "team", ruleset_ids: ["rule"] })
    ).rejects.toThrow("Rules unavailable");
  });
});
