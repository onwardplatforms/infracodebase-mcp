import { describe, it, expect, vi } from "vitest";
import { listWorkspaces } from "./list_workspaces.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_workspaces", () => {
  it("passes enterprise_id through with no kinds by default", async () => {
    const client = mockClient({ listWorkspaces: vi.fn().mockResolvedValue({ data: [] }) });
    const ctx = mockContext({ client });

    await listWorkspaces.run(ctx, { enterprise_id: "ent_1" });

    expect(client.listWorkspaces).toHaveBeenCalledWith("ent_1", undefined);
  });

  it("passes kinds through when given, so template/module workspaces can be included", async () => {
    const client = mockClient({ listWorkspaces: vi.fn().mockResolvedValue({ data: [] }) });
    const ctx = mockContext({ client });

    await listWorkspaces.run(ctx, {
      enterprise_id: "ent_1",
      kinds: ["STANDARD", "TEMPLATE", "MODULE"],
    });

    expect(client.listWorkspaces).toHaveBeenCalledWith("ent_1", [
      "STANDARD",
      "TEMPLATE",
      "MODULE",
    ]);
  });
});
