import { describe, it, expect, vi } from "vitest";
import { getWorkspaceContext } from "./get_workspace_context.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_workspace_context", () => {
  it("resolves by workspace_id via a single client call, without touching repo detection", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({ client });

    await getWorkspaceContext.run(ctx, { workspace_id: "ws_1", iac_tool: "terraform" });

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith({
      repoUrl: undefined,
      workspaceId: "ws_1",
      iacTool: "terraform",
    });
    expect(ctx.resolveRepoUrl).not.toHaveBeenCalled();
  });

  it("resolves by repo_url via the same single client call", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({ client });

    await getWorkspaceContext.run(ctx, { repo_url: "owner/name" });

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith({
      repoUrl: "owner/name",
      workspaceId: undefined,
      iacTool: undefined,
    });
  });

  it("returns the client's response verbatim for a linked workspace, including nested fields", async () => {
    const linkedResponse = {
      status: "linked",
      workspace: { id: "ws_1", name: "Infra", repo: { owner: "acme", name: "infra" } },
      rulesets: [{ id: "rs_1", title: "Security" }],
      coding_guidelines: "Use least privilege.",
      compliance: { score: 92 },
      modules: { status: "ok", count: 3 },
    };
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue(linkedResponse),
    });
    const ctx = mockContext({ client });

    const result = await getWorkspaceContext.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual(linkedResponse);
  });

  it.each(["unlinked", "no_access", "ambiguous"] as const)(
    "passes through a %s response verbatim, including its message field",
    async (status) => {
      const response = { status, owner: "owner", name: "name", message: `explanation for ${status}` };
      const client = mockClient({
        resolveWorkspaceContext: vi.fn().mockResolvedValue(response),
      });
      const ctx = mockContext({ client });

      const result = await getWorkspaceContext.run(ctx, { repo_url: "owner/name" });

      expect(result).toEqual(response);
    }
  );

  it("auto-detects the repo when called with no arguments and says where it came from", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" }),
    });
    const ctx = mockContext({
      client,
      resolveRepoUrl: vi.fn(async () => ({
        repo_url: "https://github.com/acme/infra.git",
        resolved_from: "cwd" as const,
      })),
    });

    const result = await getWorkspaceContext.run(ctx, {});

    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith({
      repoUrl: "https://github.com/acme/infra.git",
      workspaceId: undefined,
      iacTool: undefined,
    });
    expect(result).toEqual({
      status: "unlinked",
      owner: "acme",
      name: "infra",
      resolved_repo_url: "https://github.com/acme/infra.git",
      resolved_from: "cwd",
    });
  });

  it("surfaces the detector's error when no repo can be found and nothing was passed", async () => {
    const client = mockClient({ resolveWorkspaceContext: vi.fn() });
    const ctx = mockContext({ client });

    await expect(getWorkspaceContext.run(ctx, {})).rejects.toThrow(/Could not detect a git remote/);
    expect(client.resolveWorkspaceContext).not.toHaveBeenCalled();
  });
});
