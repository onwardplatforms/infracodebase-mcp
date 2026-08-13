import { describe, it, expect, vi } from "vitest";
import { getWorkspaceContext } from "./get_workspace_context.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_workspace_context", () => {
  it("resolves by workspace_id via a single client call", async () => {
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

  it("passes through whatever status the server returns (unlinked, no_access, ambiguous)", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "unlinked", owner: "owner", name: "name" }),
    });
    const ctx = mockContext({ client });

    const out = (await getWorkspaceContext.run(ctx, { repo_url: "owner/name" })) as {
      status: string;
    };

    expect(out.status).toBe("unlinked");
  });

  it("throws when neither workspace_id nor repo_url is provided", async () => {
    const client = mockClient({ resolveWorkspaceContext: vi.fn() });
    const ctx = mockContext({ client });

    await expect(getWorkspaceContext.run(ctx, {})).rejects.toThrow(
      /Provide either workspace_id or repo_url/
    );
    expect(client.resolveWorkspaceContext).not.toHaveBeenCalled();
  });
});
