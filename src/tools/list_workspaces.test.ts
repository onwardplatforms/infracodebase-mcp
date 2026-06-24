import { describe, it, expect, vi } from "vitest";
import { listWorkspaces } from "./list_workspaces.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_workspaces", () => {
  it("passes enterprise_id straight through to the client", async () => {
    const result = { data: [] };
    const client = mockClient({ listWorkspaces: vi.fn().mockResolvedValue(result) });
    const out = await listWorkspaces.run(mockContext({ client }), { enterprise_id: "ent_1" });
    expect(client.listWorkspaces).toHaveBeenCalledWith("ent_1");
    expect(out).toBe(result);
  });
});
