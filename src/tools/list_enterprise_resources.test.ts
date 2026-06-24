import { describe, it, expect, vi } from "vitest";
import { listEnterpriseResources } from "./list_enterprise_resources.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_enterprise_resources", () => {
  it("passes enterprise_id to the client", async () => {
    const client = mockClient({ listEnterpriseResources: vi.fn().mockResolvedValue({ data: {} }) });
    await listEnterpriseResources.run(mockContext({ client }), { enterprise_id: "ent_1" });
    expect(client.listEnterpriseResources).toHaveBeenCalledWith("ent_1");
  });
});
