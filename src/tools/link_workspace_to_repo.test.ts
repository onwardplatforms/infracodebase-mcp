import { describe, it, expect, vi } from "vitest";
import { linkWorkspaceToRepo } from "./link_workspace_to_repo.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("link_workspace_to_repo", () => {
  it("resolves the enterprise then links the repo with mapped field names", async () => {
    const client = mockClient({ linkWorkspaceToRepo: vi.fn().mockResolvedValue({}) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await linkWorkspaceToRepo.run(ctx, {
      workspace_id: "ws_1",
      github_installation_id: "inst_1",
      github_owner: "owner",
      github_repo: "name",
      github_branch: "main",
    });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.linkWorkspaceToRepo).toHaveBeenCalledWith("ent_1", "ws_1", {
      installation_id: "inst_1",
      owner: "owner",
      repo: "name",
      branch: "main",
    });
  });
});
