import { describe, it, expect, vi } from "vitest";
import { listGithubInstallations } from "./list_github_installations.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_github_installations", () => {
  it("passes enterprise_id to the client", async () => {
    const client = mockClient({
      listGitHubInstallations: vi.fn().mockResolvedValue({ data: [] }),
    });
    await listGithubInstallations.run(mockContext({ client }), { enterprise_id: "ent_1" });
    expect(client.listGitHubInstallations).toHaveBeenCalledWith("ent_1");
  });
});
