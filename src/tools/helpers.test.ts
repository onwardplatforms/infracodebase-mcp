import { describe, it, expect, vi } from "vitest";
import { createToolContext, registerTool, WrongEnterpriseError, type ToolDef } from "./helpers.js";
import { TOOL_ANNOTATIONS } from "./validation.js";
import { mockClient } from "../test-helpers.js";
import { ApiError } from "../client.js";
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

  it("skips an enterprise whose workspace list fails instead of failing every lookup", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_blocked" }, { id: "ent_2" }] }),
      listWorkspaces: vi.fn(async (enterpriseId: string) => {
        if (enterpriseId === "ent_blocked") throw new Error("402 payment_required");
        return { data: [{ id: "ws_2", linked_repository: { owner: "acme", name: "infra" } }] };
      }),
    });
    const tools = createToolContext(ctx);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await tools.listAllWorkspaces()).toEqual([
      { id: "ws_2", enterprise_id: "ent_2", linked_repository: { owner: "acme", name: "infra" } },
    ]);
    expect(await tools.getEnterpriseForWorkspace("ws_2")).toBe("ent_2");
    expect(await tools.getWorkspaceRepo("ws_2")).toEqual({ owner: "acme", name: "infra" });
    // Not listed by an incomplete scan is not "no repo": it may be in the
    // enterprise that failed, so the lookup says so instead of answering null.
    await expect(tools.getWorkspaceRepo("ws_unknown")).rejects.toThrow(
      /could not be listed: ent_blocked \(402 payment_required\)/
    );
    expect(quiet).toHaveBeenCalledWith(expect.stringContaining("skipping enterprise ent_blocked"));
    // The skipped enterprise is named when a workspace turns up nowhere, so a
    // rate limit or outage there is not read as a bad workspace id.
    await expect(tools.getEnterpriseForWorkspace("ws_unknown")).rejects.toThrow(
      /could not be listed: ent_blocked \(402 payment_required\)/
    );
    quiet.mockRestore();
  });

  it("throws the listing error itself when every enterprise fails, instead of 'not found'", async () => {
    const rateLimited = new ApiError(429, JSON.stringify({ code: "rate_limited" }), "/x");
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }, { id: "ent_2" }] }),
      listWorkspaces: vi.fn().mockRejectedValue(rateLimited),
    });
    const tools = createToolContext(ctx);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(tools.listAllWorkspaces()).rejects.toBe(rateLimited);
    await expect(tools.getEnterpriseForWorkspace("ws_1")).rejects.toBe(rateLimited);
    quiet.mockRestore();
  });

  it("picks the all-failed error deterministically: a 401 or 429 first, else enterprise order", async () => {
    const outage = new ApiError(500, "boom", "/x");
    const rateLimited = new ApiError(429, JSON.stringify({ code: "rate_limited" }), "/x");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    // ent_2's 429 carries the retry hint, so it wins even though ent_1 failed first.
    const hinted = createToolContext(
      serverContext({
        listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }, { id: "ent_2" }] }),
        listWorkspaces: vi.fn(async (id: string) => {
          throw id === "ent_1" ? outage : rateLimited;
        }),
      })
    );
    await expect(hinted.listAllWorkspaces()).rejects.toBe(rateLimited);

    // Without a hinted error, the first enterprise's error, whichever rejected first.
    const later = new ApiError(502, "bad gateway", "/x");
    const ordered = createToolContext(
      serverContext({
        listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }, { id: "ent_2" }] }),
        listWorkspaces: vi.fn(async (id: string) => {
          if (id === "ent_1") await new Promise((r) => setTimeout(r, 5));
          throw id === "ent_1" ? outage : later;
        }),
      })
    );
    await expect(ordered.listAllWorkspaces()).rejects.toBe(outage);
    quiet.mockRestore();
  });

  it("requests every workspace kind, not just the API's STANDARD-only default", async () => {
    // A TEMPLATE/MODULE workspace must still be discoverable here —
    // otherwise getEnterpriseForWorkspace's fallback scan (used when a tool
    // is given a bare workspace_id with no enterprise_id hint) would miss it.
    const listWorkspaces = vi.fn().mockResolvedValue({ data: [] });
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces,
    });
    const tools = createToolContext(ctx);

    await tools.listAllWorkspaces();

    expect(listWorkspaces).toHaveBeenCalledWith("ent_1", ["STANDARD", "TEMPLATE", "MODULE"]);
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

describe("createToolContext — getWorkspaceRepo", () => {
  const repo = { owner: "acme", name: "infra", host: "github.com", display_path: "acme/infra" };

  it("fetches the one workspace when the enterprise is known, without a scan, and caches it", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue({ id: "ws_1", linked_repository: repo }),
    });
    const tools = createToolContext(ctx);

    expect(await tools.getWorkspaceRepo("ws_1", "ent_hint")).toEqual(repo);
    expect(await tools.getWorkspaceRepo("ws_1")).toEqual(repo);
    expect(ctx.client.getWorkspace).toHaveBeenCalledTimes(1);
    expect(ctx.client.getWorkspace).toHaveBeenCalledWith("ent_hint", "ws_1");
    expect(ctx.client.listEnterprises).not.toHaveBeenCalled();
  });

  it("uses the warm enterprise map the same way as a hint", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue({ id: "ws_1", linked_repository: repo }),
    });
    ctx.workspaceEnterpriseMap.set("ws_1", "ent_cached");
    const tools = createToolContext(ctx);

    expect(await tools.getWorkspaceRepo("ws_1")).toEqual(repo);
    expect(ctx.client.getWorkspace).toHaveBeenCalledWith("ent_cached", "ws_1");
    expect(ctx.client.listEnterprises).not.toHaveBeenCalled();
  });

  it("falls back to a scan when the direct fetch 404s, and rethrows anything else", async () => {
    // A server without the single-workspace endpoint: the scan still answers.
    const notFound = new ApiError(404, "Not Found", "/x");
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [{ id: "ws_1", linked_repository: repo }] }),
      getWorkspace: vi.fn().mockRejectedValue(notFound),
    });
    const tools = createToolContext(ctx);

    expect(await tools.getWorkspaceRepo("ws_1", "ent_1")).toEqual(repo);

    const denied = new ApiError(403, "forbidden", "/x");
    const strict = createToolContext(
      serverContext({ listEnterprises: vi.fn(), getWorkspace: vi.fn().mockRejectedValue(denied) })
    );
    await expect(strict.getWorkspaceRepo("ws_1", "ent_1")).rejects.toBe(denied);
  });

  it("does not cache a workspace returned under a different enterprise", async () => {
    const wrongRepo = { owner: "other", name: "infra" };
    const ctx = serverContext({
      getWorkspace: vi.fn().mockResolvedValue({
        id: "ws_1",
        enterprise: { id: "ent_other" },
        linked_repository: wrongRepo,
      }),
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_expected" }] }),
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ data: [{ id: "ws_1", linked_repository: repo }] }),
    });
    const tools = createToolContext(ctx);

    await expect(tools.getWorkspaceRepo("ws_1", "ent_expected")).resolves.toEqual(repo);
    expect(ctx.client.getWorkspace).toHaveBeenCalledWith("ent_expected", "ws_1");
  });

  it("names the right enterprise when the hint is wrong, instead of an opaque 404 later", async () => {
    const notFound = new ApiError(404, JSON.stringify({ code: "workspace_not_found" }), "/x");
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [{ id: "ws_1", linked_repository: repo }] }),
      getWorkspace: vi.fn().mockRejectedValue(notFound),
    });
    const tools = createToolContext(ctx);

    await expect(tools.getWorkspaceRepo("ws_1", "ent_wrong")).rejects.toThrow(
      new WrongEnterpriseError("ws_1", "ent_wrong", "ent_1").message
    );
  });

  it("does not remember a miss from an incomplete scan, and a later hint tries the direct fetch", async () => {
    let flaky = true;
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_ok" }, { id: "ent_flaky" }] }),
      listWorkspaces: vi.fn(async (id: string) => {
        if (id === "ent_flaky" && flaky) throw new ApiError(429, "slow down", "/x");
        return { data: id === "ent_flaky" ? [{ id: "ws_1", linked_repository: repo }] : [] };
      }),
      getWorkspace: vi.fn().mockResolvedValue({ id: "ws_1", linked_repository: repo }),
    });
    const tools = createToolContext(ctx);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    // The scan could not see ent_flaky, so the answer is a failure, not "no repo".
    await expect(tools.getWorkspaceRepo("ws_1")).rejects.toThrow(/ent_flaky \(.*429/);
    // A hint is a new lead and goes straight to the direct fetch.
    expect(await tools.getWorkspaceRepo("ws_1", "ent_flaky")).toEqual(repo);
    expect(ctx.client.getWorkspace).toHaveBeenCalledWith("ent_flaky", "ws_1");
    // And once the enterprise recovers, a hintless call rescans rather than
    // trusting the earlier miss.
    tools.forgetWorkspaceRepo("ws_1");
    flaky = false;
    expect(await tools.getWorkspaceRepo("ws_1")).toEqual(repo);
    quiet.mockRestore();
  });

  it("remembers a workspace the scan did not list instead of rescanning on every call", async () => {
    const ctx = serverContext({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [] }),
    });
    const tools = createToolContext(ctx);

    expect(await tools.getWorkspaceRepo("ws_far")).toBeNull();
    expect(await tools.getWorkspaceRepo("ws_far")).toBeNull();
    expect(ctx.client.listEnterprises).toHaveBeenCalledTimes(1);

    // A hint bypasses the remembered miss: the workspace may be past the
    // first page of its enterprise, which the direct fetch does not care about.
    ctx.client.getWorkspace.mockResolvedValue({ id: "ws_far", linked_repository: repo });
    expect(await tools.getWorkspaceRepo("ws_far", "ent_1")).toEqual(repo);
  });

  it("refetches after forgetWorkspaceRepo, so a changed link is seen", async () => {
    const other = { owner: "acme", name: "payments" };
    const ctx = serverContext({
      getWorkspace: vi
        .fn()
        .mockResolvedValueOnce({ id: "ws_1", linked_repository: repo })
        .mockResolvedValueOnce({ id: "ws_1", linked_repository: other }),
    });
    const tools = createToolContext(ctx);

    expect(await tools.getWorkspaceRepo("ws_1", "ent_1")).toEqual(repo);
    tools.forgetWorkspaceRepo("ws_1");
    expect(await tools.getWorkspaceRepo("ws_1", "ent_1")).toEqual(other);
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

describe("registerTool — metadata", () => {
  it("passes the tool's title, annotations, description, and schema to the server", () => {
    const calls: Array<{ name: string; config: any }> = [];
    const server = {
      registerTool: (name: string, config: unknown) => {
        calls.push({ name, config });
      },
    } as any;

    registerTool(server, { name: "get_workspace_context", run: async () => ({}) }, {} as any);

    expect(calls[0].config).toMatchObject({
      title: "Get workspace context",
      annotations: TOOL_ANNOTATIONS.get_workspace_context,
    });
    expect(calls[0].config.annotations.readOnlyHint).toBe(true);
    expect(typeof calls[0].config.description).toBe("string");
    expect(calls[0].config.inputSchema).toBeDefined();
  });
});
