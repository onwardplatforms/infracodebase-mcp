import { describe, it, expect, vi } from "vitest";
import { getRulesetDetails } from "./get_ruleset_details.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_ruleset_details", () => {
  it("resolves the enterprise then fetches the ruleset", async () => {
    const client = mockClient({ getRulesetDetails: vi.fn().mockResolvedValue({ data: {} }) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await getRulesetDetails.run(ctx, { workspace_id: "ws_1", ruleset_id: "rs_1" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.getRulesetDetails).toHaveBeenCalledWith("ent_1", "rs_1");
  });
});
