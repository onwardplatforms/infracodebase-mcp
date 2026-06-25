import { describe, it, expect, vi } from "vitest";
import { registerAllTools, TOOLS } from "./index.js";
import { mockClient } from "../test-helpers.js";
import type { ServerContext } from "../server.js";

/**
 * Seam-level tests: drive tools the way the MCP server actually does — through
 * registerAllTools + the real createToolContext — instead of calling each
 * `run()` in isolation. Only the InfracodebaseClient (the true process
 * boundary) is mocked; the workspace->enterprise resolution runs for real.
 *
 * This replaces the per-tool "did it forward the args" tautologies with a few
 * tests of behavior that those never reached: the real resolution chain, the
 * JSON CallToolResult shape, and the try/catch that turns a client failure into
 * an isError result.
 */

/** A server stand-in that captures each registered handler by tool name. */
function fakeServer() {
  const handlers = new Map<string, (args: unknown) => Promise<any>>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: (args: unknown) => Promise<any>) => {
      handlers.set(name, handler);
    },
  };
  return { server: server as any, handlers };
}

/** Register every tool against a context whose only mocked part is the client. */
async function registerWith(clientMethods: Record<string, unknown>) {
  const context: ServerContext = {
    client: mockClient(clientMethods),
    workspaceEnterpriseMap: new Map(),
  };
  const { server, handlers } = fakeServer();
  await registerAllTools(server, context);
  return { handlers, client: context.client };
}

describe("tool seam — registration", () => {
  it("registers a handler for every tool in the registry", async () => {
    const { handlers } = await registerWith({});
    expect([...handlers.keys()].sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });
});

describe("tool seam — end-to-end through real resolution", () => {
  it("resolves the enterprise from the workspace, then returns a JSON result", async () => {
    const { handlers, client } = await registerWith({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [{ id: "ws_1" }] }),
      getComplianceEvaluation: vi.fn().mockResolvedValue({ score: 100 }),
    });

    const result = await handlers.get("get_compliance_evaluation")!({ workspace_id: "ws_1" });

    // Resolution actually ran (no enterprise_id was supplied) and reached the API.
    expect(client.getComplianceEvaluation).toHaveBeenCalledWith("ent_1", "ws_1", undefined);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ score: 100 });
  });

  it("returns a JSON result for a tool that needs no resolution", async () => {
    const { handlers } = await registerWith({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
    });

    const result = await handlers.get("list_enterprises")!({});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ data: [{ id: "ent_1" }] });
  });
});

describe("tool seam — failure handling", () => {
  it("turns a client rejection into an isError result instead of throwing", async () => {
    const { handlers } = await registerWith({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [{ id: "ws_1" }] }),
      getComplianceEvaluation: vi.fn().mockRejectedValue(new Error("403 forbidden")),
    });

    const result = await handlers.get("get_compliance_evaluation")!({ workspace_id: "ws_1" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("403 forbidden");
  });

  it("surfaces an unresolvable workspace as an isError result", async () => {
    const { handlers } = await registerWith({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [] }),
    });

    const result = await handlers.get("get_compliance_evaluation")!({ workspace_id: "ws_missing" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found in any accessible enterprise");
  });
});
