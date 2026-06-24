import { describe, it, expect, vi } from "vitest";
import { listEnterprises } from "./list_enterprises.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_enterprises", () => {
  it("delegates to client.listEnterprises and returns its result", async () => {
    const result = { data: [{ id: "ent_1" }] };
    const client = mockClient({ listEnterprises: vi.fn().mockResolvedValue(result) });
    const out = await listEnterprises.run(mockContext({ client }), {});
    expect(client.listEnterprises).toHaveBeenCalledTimes(1);
    expect(out).toBe(result);
  });
});
