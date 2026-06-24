import { describe, it, expect, vi } from "vitest";
import { listGithubRepos } from "./list_github_repos.js";
import { mockClient, mockContext } from "../test-helpers.js";

describe("list_github_repos", () => {
  it("forwards enterprise_id, installation_id, and search to the client", async () => {
    const client = mockClient({ listGitHubRepos: vi.fn().mockResolvedValue({ data: [] }) });
    await listGithubRepos.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      installation_id: "inst_1",
      search: "infra",
    });
    expect(client.listGitHubRepos).toHaveBeenCalledWith("ent_1", "inst_1", "infra");
  });

  it("forwards an undefined search when omitted", async () => {
    const client = mockClient({ listGitHubRepos: vi.fn().mockResolvedValue({ data: [] }) });
    await listGithubRepos.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      installation_id: "inst_1",
    });
    expect(client.listGitHubRepos).toHaveBeenCalledWith("ent_1", "inst_1", undefined);
  });
});
