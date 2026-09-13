import { afterEach, describe, expect, it, vi } from "vitest";
import { InfracodebaseClient } from "../client.js";
import { mockContext } from "../test-helpers.js";
import { startRulesetSync } from "./start_ruleset_sync.js";
import { getRulesetSync } from "./get_ruleset_sync.js";
import { listRulesetSyncs } from "./list_ruleset_syncs.js";
import { applyRulesetSync } from "./apply_ruleset_sync.js";
import { dismissRulesetSync } from "./dismiss_ruleset_sync.js";

afterEach(() => vi.unstubAllGlobals());
describe("ruleset sync tools over the public API", () => {
  it("starts once, reads the saved proposal, and forwards only the user's selected changes", async () => {
    const responses = [
      { id: "run", status: "queued", url: "/acme/production/settings/rulesets/sync/run" },
      { id: "run", status: "needs_review", changes: [{ id: "change-a", enabled: true, eligible: true }, { id: "change-b", enabled: false, eligible: false, blocked_reason: "Now required" }] },
      { id: "run", status: "applied", selected_change_ids: ["change-a"] },
    ];
    const fetcher = vi.fn();
    for (const value of responses) fetcher.mockResolvedValueOnce(new Response(JSON.stringify(value)));
    vi.stubGlobal("fetch", fetcher);
    const ctx = mockContext({ client: new InfracodebaseClient({ baseUrl: "https://api.example.test/api/v1", token: "test-token" }), getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent") });
    const started = await startRulesetSync.run(ctx, { workspace_id: "ws", request_key: "retry-key" });
    expect(started).toEqual(responses[0]);
    const [startUrl, init] = fetcher.mock.calls[0];
    expect(new URL(startUrl).pathname).toBe("/api/v1/enterprises/ent/workspaces/ws/ruleset-syncs");
    expect(init.method).toBe("POST"); expect(JSON.parse(init.body)).toEqual({ request_key: "retry-key", source: "mcp" });
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(await getRulesetSync.run(ctx, { workspace_id: "ws", run_id: "run" })).toEqual(responses[1]);
    expect(fetcher.mock.calls[1][1].method).toBe("GET");
    expect(await applyRulesetSync.run(ctx, { workspace_id: "ws", run_id: "run", selected_change_ids: ["change-a"] })).toEqual(responses[2]);
    expect(new URL(fetcher.mock.calls[2][0]).pathname).toBe("/api/v1/enterprises/ent/workspaces/ws/ruleset-syncs/run/apply");
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ selected_change_ids: ["change-a"] });
  });
  it("finds outstanding reviews and dismisses without sending any enablement updates", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: "dismissed" })));
    vi.stubGlobal("fetch", fetcher);
    const ctx = mockContext({ client: new InfracodebaseClient({ baseUrl: "https://api.example.test/api/v1", token: "t" }), getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent") });
    await listRulesetSyncs.run(ctx, { workspace_id: "ws", status: "needs_review", cursor: "last" });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("status")).toBe("needs_review"); expect(url.searchParams.get("cursor")).toBe("last");
    await dismissRulesetSync.run(ctx, { workspace_id: "ws", run_id: "run" });
    expect(new URL(fetcher.mock.calls[1][0]).pathname).toBe("/api/v1/enterprises/ent/workspaces/ws/ruleset-syncs/run/dismiss");
    expect(fetcher.mock.calls[1][1].body).toBeUndefined();
  });
});
