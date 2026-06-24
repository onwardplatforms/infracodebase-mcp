import { describe, it, expect, vi } from "vitest";
import { getWorkspaceContext } from "./get_workspace_context.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("get_workspace_context", () => {
  it("resolves the enterprise from workspace_id and fetches context", async () => {
    const client = mockClient({ getWorkspaceContext: vi.fn().mockResolvedValue({ ok: true }) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await getWorkspaceContext.run(ctx, { workspace_id: "ws_1", iac_tool: "terraform" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.getWorkspaceContext).toHaveBeenCalledWith("ent_1", "ws_1", "terraform");
  });

  it("passes an enterprise_id hint through to resolution", async () => {
    const client = mockClient({ getWorkspaceContext: vi.fn().mockResolvedValue({}) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_9");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await getWorkspaceContext.run(ctx, { workspace_id: "ws_1", enterprise_id: "ent_9" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", "ent_9");
  });

  it("resolves a repo_url to its workspace and fetches context", async () => {
    const client = mockClient({ getWorkspaceContext: vi.fn().mockResolvedValue({ ok: true }) });
    const resolveWorkspaceByRepo = vi
      .fn()
      .mockResolvedValue({ id: "ws_2", enterprise_id: "ent_2" });
    const ctx = mockContext({ client, resolveWorkspaceByRepo });

    await getWorkspaceContext.run(ctx, { repo_url: "owner/name" });

    expect(resolveWorkspaceByRepo).toHaveBeenCalledWith("owner/name");
    expect(client.getWorkspaceContext).toHaveBeenCalledWith("ent_2", "ws_2", undefined);
  });

  it("returns an 'unlinked' status (not an error) when no workspace matches the repo", async () => {
    const client = mockClient({ getWorkspaceContext: vi.fn() });
    const ctx = mockContext({ client, resolveWorkspaceByRepo: vi.fn().mockResolvedValue(null) });

    const out = (await getWorkspaceContext.run(ctx, { repo_url: "owner/name" })) as {
      status: string;
      repo_url: string;
    };

    expect(out.status).toBe("unlinked");
    expect(out.repo_url).toBe("owner/name");
    expect(client.getWorkspaceContext).not.toHaveBeenCalled();
  });

  it("throws when neither workspace_id nor repo_url is provided", async () => {
    await expect(getWorkspaceContext.run(mockContext(), {})).rejects.toThrow(
      /Provide either workspace_id or repo_url/
    );
  });
});
