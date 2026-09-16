import { describe, it, expect, vi } from "vitest";
import { listModules } from "./list_modules.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("module discovery without a workspace", () => {
  it("fetches versions only for the selected module when context already identifies it", async () => {
    const client = mockClient({
      listModules: vi.fn().mockResolvedValue({ modules: [{ id: "ec2", versions: ["1.0.0"] }] }),
    });
    await listModules.run(mockContext({ client }), { enterprise_id: "team", module_id: "ec2" });
    expect(client.listModules).toHaveBeenCalledExactlyOnceWith("team", "ec2");
    expect(client.listEnterprises).not.toHaveBeenCalled();
  });
  it("returns the sole enterprise's catalog without resolving or creating a workspace", async () => {
    const module = {
      name: "terraform-aws-ec2",
      description: "A single EC2 instance",
      source_url: "https://git.example/team/ec2",
      registry_source: "tfe.example/team/ec2/aws",
      source_kind: "registry",
      versions: ["1.0.0"],
    };
    const client = mockClient({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent1", name: "Team" }] }),
      listModules: vi.fn().mockResolvedValue({ modules: [module] }),
    });
    const result = await listModules.run(mockContext({ client }), {});
    expect(result).toMatchObject({ enterprise_id: "ent1", modules: [module] });
    expect(client.listModules).toHaveBeenCalledWith("ent1");
    expect(client.resolveWorkspaceContext).not.toHaveBeenCalled();
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });
  it("requires a choice before reading any of multiple enterprises' catalogs", async () => {
    const client = mockClient({
      listEnterprises: vi.fn().mockResolvedValue({
        data: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      }),
    });
    const result = await listModules.run(mockContext({ client }), {});
    expect(result).toMatchObject({
      status: "needs_enterprise",
      enterprises: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    });
    expect(client.listModules).not.toHaveBeenCalled();
  });
  it("uses the chosen enterprise rather than discovering or merging other catalogs", async () => {
    const client = mockClient({ listModules: vi.fn().mockResolvedValue({ modules: [] }) });
    expect(
      await listModules.run(mockContext({ client }), { enterprise_id: "chosen" })
    ).toMatchObject({ enterprise_id: "chosen", modules: [] });
    expect(client.listEnterprises).not.toHaveBeenCalled();
    expect(client.listModules).toHaveBeenCalledWith("chosen");
  });
  it("distinguishes no enterprise access from an empty module catalog", async () => {
    const client = mockClient({ listEnterprises: vi.fn().mockResolvedValue({ data: [] }) });
    const result = await listModules.run(mockContext({ client }), {});
    expect(result).toMatchObject({ status: "no_access" });
    expect(result).not.toHaveProperty("modules");
    expect(client.listModules).not.toHaveBeenCalled();
  });
  it("preserves catalog failures rather than returning an empty successful result", async () => {
    const client = mockClient({
      listModules: vi.fn().mockRejectedValue(new Error("403 forbidden")),
    });
    await expect(
      listModules.run(mockContext({ client }), { enterprise_id: "chosen" })
    ).rejects.toThrow("403 forbidden");
  });
});
