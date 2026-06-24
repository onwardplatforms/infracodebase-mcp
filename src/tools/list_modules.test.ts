import { describe, it, expect, vi } from "vitest";
import { listModules } from "./list_modules.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_modules", () => {
  it("passes enterprise_id to the client", async () => {
    const client = mockClient({ listModules: vi.fn().mockResolvedValue({ data: [] }) });
    await listModules.run(mockContext({ client }), { enterprise_id: "ent_1" });
    expect(client.listModules).toHaveBeenCalledWith("ent_1");
  });
});
