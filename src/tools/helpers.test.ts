import { describe, it, expect, vi } from "vitest";
import { createToolContext, registerTool, type ToolDef } from "./helpers.js";
import { mockClient } from "../test-helpers.js";
import type { ServerContext } from "../server.js";

function serverContext(clientMethods = {}): ServerContext {
  return {
    client: mockClient(clientMethods),
    workspaceEnterpriseMap: new Map(),
  };
}

describe("createToolContext — listAllWorkspaces", () => {
  it("flattens workspaces across enterprises and warms the enterprise map", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }, { id: "ent_2" }] }),
      listWorkspaces: vi
        .fn()
        .mockResolvedValueOnce({ data: [{ id: "ws_1" }] })
        .mockResolvedValueOnce({ data: [{ id: "ws_2" }] }),
    });
    const tools = createToolContext(ctx);

    const all = await tools.listAllWorkspaces();

    expect(all).toEqual([
      { id: "ws_1", enterprise_id: "ent_1" },
      { id: "ws_2", enterprise_id: "ent_2" },
    ]);
    expect(ctx.workspaceEnterpriseMap.get("ws_1")).toBe("ent_1");
    expect(ctx.workspaceEnterpriseMap.get("ws_2")).toBe("ent_2");
  });
});

describe("createToolContext — getEnterpriseForWorkspace", () => {
  it("returns the hint without any lookup", async () => {
    const ctx = serverContext({ listEnterprises: vi.fn() });
    const tools = createToolContext(ctx);

    expect(await tools.getEnterpriseForWorkspace("ws_1", "ent_hint")).toBe("ent_hint");
    expect(ctx.client.listEnterprises).not.toHaveBeenCalled();
  });

  it("returns a cached mapping without scanning", async () => {
    const ctx = serverContext({ listEnterprises: vi.fn() });
    ctx.workspaceEnterpriseMap.set("ws_1", "ent_cached");
    const tools = createToolContext(ctx);

    expect(await tools.getEnterpriseForWorkspace("ws_1")).toBe("ent_cached");
    expect(ctx.client.listEnterprises).not.toHaveBeenCalled();
  });

  it("scans all enterprises when the workspace isn't cached", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [{ id: "ws_1" }] }),
    });
    const tools = createToolContext(ctx);

    expect(await tools.getEnterpriseForWorkspace("ws_1")).toBe("ent_1");
  });

  it("throws a guidance error when the workspace exists nowhere", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [] }),
    });
    const tools = createToolContext(ctx);

    await expect(tools.getEnterpriseForWorkspace("ws_missing")).rejects.toThrow(
      /not found in any accessible enterprise/
    );
  });
});

describe("createToolContext — resolveWorkspaceByRepo", () => {
  it("matches a workspace by owner/name case-insensitively", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ data: [{ id: "ws_1", repo: { owner: "Owner", name: "Repo" } }] }),
    });
    const tools = createToolContext(ctx);

    const found = await tools.resolveWorkspaceByRepo("https://github.com/owner/repo");
    expect(found?.id).toBe("ws_1");
  });

  it("returns null when no workspace is linked to the repo", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [{ id: "ws_1", repo: null }] }),
    });
    const tools = createToolContext(ctx);

    expect(await tools.resolveWorkspaceByRepo("owner/repo")).toBeNull();
  });

  it("throws on an unparseable repo URL", async () => {
    const tools = createToolContext(serverContext());
    await expect(tools.resolveWorkspaceByRepo("not-a-repo")).rejects.toThrow(/Could not parse/);
  });
});

describe("registerTool", () => {
  /** Capture the handler McpServer.registerTool would store. */
  function fakeServer() {
    const calls: Array<{ name: string; config: unknown; handler: (a: unknown) => Promise<any> }> = [];
    const server = {
      registerTool: (name: string, config: unknown, handler: (a: unknown) => Promise<any>) => {
        calls.push({ name, config, handler });
      },
    };
    return { server: server as any, calls };
  }

  it("registers under the tool's name and JSON-formats a successful result", async () => {
    const { server, calls } = fakeServer();
    const tool: ToolDef = { name: "list_enterprises", run: async () => ({ data: [1, 2] }) };

    registerTool(server, tool, {} as any);

    expect(calls[0].name).toBe("list_enterprises");
    const result = await calls[0].handler({});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ data: [1, 2] });
  });

  it("converts a thrown error into an isError result instead of rejecting", async () => {
    const { server, calls } = fakeServer();
    const tool: ToolDef = {
      name: "list_enterprises",
      run: async () => {
        throw new Error("boom");
      },
    };

    registerTool(server, tool, {} as any);

    const result = await calls[0].handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });
});
