import { describe, it, expect, vi } from "vitest";
import { registerAllTools, TOOLS } from "./index.js";
import { mockClient } from "../test-helpers.js";
import { ApiError } from "../client.js";
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
    // The real resolver also reads the checked-out branch of this working
    // directory, which is a branch name here and nothing on a detached CI HEAD.
    expect(client.getComplianceEvaluation).toHaveBeenCalledWith(
      "ent_1",
      "ws_1",
      undefined,
      expect.toSatisfy((v: unknown) => v === undefined || typeof v === "string")
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ score: 100 });
  });

  it("returns a JSON result for a tool that needs no resolution", async () => {
    const { handlers } = await registerWith({
      listEnterprises: vi.fn().mockResolvedValue({ data: [{ id: "ent_1" }] }),
    });

    const result = await handlers.get("list_enterprises")!({});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ data: [{ id: "ent_1" }] });
  });

  it("submits every exception and reports an individual rejection without losing successful requests", async () => {
    const { handlers, client } = await registerWith({
      submitComplianceException: vi
        .fn()
        .mockResolvedValueOnce({ state: "pending" })
        .mockRejectedValueOnce(new Error("422 policy blocked")),
    });

    const result = await handlers.get("submit_compliance_exceptions")!({
      enterprise_id: "ent_1",
      workspace_id: "ws_1",
      exceptions: [
        { rule_id: "rule_1", type: "risk_acceptance", justification: "This is an intentional temporary risk." },
        { rule_id: "rule_2", type: "not_applicable", justification: "This control does not apply to this resource." },
      ],
      mode: "request",
    });

    expect(client.submitComplianceException).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      results: [
        { rule_id: "rule_1", result: { state: "pending" } },
        { rule_id: "rule_2", error: "422 policy blocked" },
      ],
    });
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

  it("surfaces an enterprise-token refusal on an exception decision as a readable error", async () => {
    const { handlers } = await registerWith({
      approveComplianceException: vi.fn().mockRejectedValue(
        new ApiError(
          403,
          JSON.stringify({
            type: "permission_error",
            code: "user_context_required",
            message:
              "Compliance exception decisions are recorded under the name of the person who made them.",
          }),
          "/enterprises/ent_1/workspaces/ws_1/compliance/exceptions/r_1/approve"
        )
      ),
    });

    const result = await handlers.get("approve_compliance_exception")!({
      workspace_id: "ws_1",
      enterprise_id: "ent_1",
      rule_id: "r_1",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("recorded under the name of the person");
    expect(result.content[0].text).toContain("user_context_required");
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
