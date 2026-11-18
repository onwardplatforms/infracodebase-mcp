import { describe, it, expect, vi } from "vitest";
import { linkWorkspaceToRepo } from "./link_workspace_to_repo.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("link_workspace_to_repo", () => {
  it("links the repo, then forgets the cached repo so branch detection sees the new link", async () => {
    const client = mockClient({
      linkWorkspaceToRepo: vi.fn().mockResolvedValue({ path: "acme/infra", branch: "main" }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await linkWorkspaceToRepo.run(ctx, {
      workspace_id: "ws_1",
      connection_id: "conn_1",
      repo_path: "acme/infra",
      branch: "main",
    });

    expect(client.linkWorkspaceToRepo).toHaveBeenCalledWith("ent_1", "ws_1", {
      connection_id: "conn_1",
      path: "acme/infra",
      branch: "main",
    });
    expect(ctx.forgetWorkspaceRepo).toHaveBeenCalledWith("ws_1");
    expect(result).toEqual({ path: "acme/infra", branch: "main" });
  });

  it("does not forget anything when the link fails", async () => {
    const failure = new Error("422 branch does not exist");
    const ctx = mockContext({
      client: mockClient({ linkWorkspaceToRepo: vi.fn().mockRejectedValue(failure) }),
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
    });

    await expect(
      linkWorkspaceToRepo.run(ctx, { workspace_id: "ws_1", connection_id: "c", repo_path: "a/b", branch: "main" })
    ).rejects.toBe(failure);
    expect(ctx.forgetWorkspaceRepo).not.toHaveBeenCalled();
  });
});
