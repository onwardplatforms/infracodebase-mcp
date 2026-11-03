import { describe, it, expect, vi } from "vitest";
import { listWorkspaceRulesets } from "./list_workspace_rulesets.js";
import { mockClient, mockContext } from "../test-helpers.js";

const NO_BRANCH = { branch_detection: "no_checkout", branch_note: expect.any(String) };

describe("list_workspace_rulesets", () => {
  it("resolves the enterprise and fetches the workspace's full ruleset list", async () => {
    const client = mockClient({ listWorkspaceRulesets: vi.fn().mockResolvedValue({ data: [] }) });
    const getEnterpriseForWorkspace = vi.fn().mockResolvedValue("ent_1");
    const ctx = mockContext({ client, getEnterpriseForWorkspace });

    await listWorkspaceRulesets.run(ctx, { workspace_id: "ws_1" });

    expect(getEnterpriseForWorkspace).toHaveBeenCalledWith("ws_1", undefined);
    expect(client.listWorkspaceRulesets).toHaveBeenCalledWith("ent_1", "ws_1", undefined);
  });

  it("returns the client's response verbatim, including unattached rulesets", async () => {
    const client = mockClient({
      listWorkspaceRulesets: vi.fn().mockResolvedValue({
        data: [
          { id: "rs_1", title: "Attached ruleset", effective_enabled: true, workspace_setting: null },
          {
            id: "rs_2",
            title: "Available but unattached",
            effective_enabled: false,
            workspace_setting: null,
          },
        ],
      }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await listWorkspaceRulesets.run(ctx, { workspace_id: "ws_1" });

    expect(result).toEqual({
      ...NO_BRANCH,
      data: [
        { id: "rs_1", title: "Attached ruleset", effective_enabled: true, workspace_setting: null },
        {
          id: "rs_2",
          title: "Available but unattached",
          effective_enabled: false,
          workspace_setting: null,
        },
      ],
    });
  });

  it("passes an explicit branch through without reporting detection", async () => {
    const client = mockClient({
      listWorkspaceRulesets: vi.fn().mockResolvedValue({ data: [], branch: { name: "feature/x" } }),
    });
    const ctx = mockContext({ client, getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1") });

    const result = await listWorkspaceRulesets.run(ctx, { workspace_id: "ws_1", branch: "feature/x" });

    expect(client.listWorkspaceRulesets).toHaveBeenCalledWith("ent_1", "ws_1", "feature/x");
    expect(result).toEqual({ data: [], branch: { name: "feature/x" } });
  });

  it("uses the checked-out branch when none is given and says where it came from", async () => {
    const client = mockClient({ listWorkspaceRulesets: vi.fn().mockResolvedValue({ data: [] }) });
    const ctx = mockContext({
      client,
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
      resolveBranch: vi.fn(async () => ({ branch: "feature/cwd", resolved_from: "cwd" as const })),
    });

    const result = await listWorkspaceRulesets.run(ctx, { workspace_id: "ws_1" });

    expect(client.listWorkspaceRulesets).toHaveBeenCalledWith("ent_1", "ws_1", "feature/cwd");
    expect(result).toEqual({ data: [], resolved_branch: "feature/cwd", branch_resolved_from: "cwd" });
  });

  it("only takes the branch from a checkout of this workspace's repo", async () => {
    const client = mockClient({ listWorkspaceRulesets: vi.fn().mockResolvedValue({ data: [] }) });
    const getWorkspaceRepo = vi.fn(async () => ({ owner: "acme", name: "infra" }));
    const resolveBranch = vi.fn(async () => ({ branch: null, reason: "other_repo" as const }));
    const ctx = mockContext({
      client,
      getEnterpriseForWorkspace: vi.fn().mockResolvedValue("ent_1"),
      getWorkspaceRepo,
      resolveBranch,
    });

    const result = await listWorkspaceRulesets.run(ctx, { workspace_id: "ws_1" });

    expect(resolveBranch).toHaveBeenCalledWith(undefined, { repo: { owner: "acme", name: "infra" } });
    expect(client.listWorkspaceRulesets).toHaveBeenCalledWith("ent_1", "ws_1", undefined);
    expect(result).toMatchObject({ data: [], branch_detection: "other_repo" });
  });
});
