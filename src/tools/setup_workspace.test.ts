import { describe, it, expect, vi } from "vitest";
import { setupWorkspace } from "./setup_workspace.js";
import { mockClient, mockContext } from "../test-helpers.js";

const plan = {
  enterprise_id: "ent_1",
  connection_id: "conn_1",
  repo_path: "acme/infra",
  branch: "main",
};

describe("setup_workspace — create a new workspace", () => {
  it("creates the workspace with its repo link and rulesets, then reloads the context", async () => {
    const client = mockClient({
      createWorkspace: vi.fn().mockResolvedValue({
        workspace: { id: "ws_new", name: "infra" },
        repository_linked: true,
      }),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked", rulesets: [] }),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      ...plan,
      workspace_name: "infra",
      ruleset_ids: ["rs_req", "rs_opt"],
      iac_tool: "terraform",
    })) as any;

    expect(client.createWorkspace).toHaveBeenCalledWith("ent_1", {
      name: "infra",
      description: undefined,
      ruleset_ids: ["rs_req", "rs_opt"],
      repository: { connection_id: "conn_1", path: "acme/infra", branch: "main" },
    });
    expect(client.resolveWorkspaceContext).toHaveBeenCalledWith({
      workspaceId: "ws_new",
      iacTool: "terraform",
    });
    expect(result).toMatchObject({
      status: "linked",
      workspace_id: "ws_new",
      repository_linked: true,
      context: { status: "linked" },
    });
    expect(result.next).toContain("trigger_compliance_evaluation");
  });

  it("names a failed link in status and next instead of reporting success", async () => {
    const client = mockClient({
      createWorkspace: vi.fn().mockResolvedValue({
        workspace: { id: "ws_new" },
        repository_linked: false,
        repository_error: "Branch main does not exist on the remote.",
      }),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      ...plan,
      workspace_name: "infra",
    })) as any;

    expect(result.status).toBe("workspace_ready_but_link_failed");
    expect(result.repository_error).toBe("Branch main does not exist on the remote.");
    expect(result.next).toContain("Branch main does not exist on the remote.");
    expect(result.next).toContain("link_workspace_to_repo");
  });

  it("carries a webhook warning into status and next", async () => {
    const client = mockClient({
      createWorkspace: vi.fn().mockResolvedValue({
        workspace: { id: "ws_new" },
        repository_linked: true,
        warning: "webhook registration failed: 403 from GitHub",
      }),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      ...plan,
      workspace_name: "infra",
    })) as any;

    expect(result.status).toBe("linked_with_warning");
    expect(result.next).toContain("webhook registration failed: 403 from GitHub");
    expect(result.next).toContain("will NOT trigger compliance");
  });

  it("refuses to run without a workspace_name or an existing_workspace_id", async () => {
    const client = mockClient();

    await expect(setupWorkspace.run(mockContext({ client }), plan)).rejects.toThrow(
      /Pass workspace_name to create a new workspace, or existing_workspace_id/
    );
    expect(client.createWorkspace).not.toHaveBeenCalled();
    expect(client.linkWorkspaceToRepo).not.toHaveBeenCalled();
  });
});

describe("setup_workspace — link an existing workspace", () => {
  it("links the repo, attaches the chosen rulesets, and reloads the context", async () => {
    const client = mockClient({
      linkWorkspaceToRepo: vi.fn().mockResolvedValue({ path: "acme/infra", branch: "main" }),
      updateWorkspaceResources: vi.fn().mockResolvedValue({ added: { rulesets: 1 } }),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      ...plan,
      existing_workspace_id: "ws_free",
      ruleset_ids: ["rs_opt"],
    })) as any;

    expect(client.linkWorkspaceToRepo).toHaveBeenCalledWith("ent_1", "ws_free", {
      connection_id: "conn_1",
      path: "acme/infra",
      branch: "main",
    });
    expect(client.updateWorkspaceResources).toHaveBeenCalledWith("ent_1", "ws_free", {
      add_ruleset_ids: ["rs_opt"],
    });
    expect(client.createWorkspace).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "linked", workspace_id: "ws_free", repository_linked: true });
  });

  it("skips the resource update when no rulesets were chosen", async () => {
    const client = mockClient({
      linkWorkspaceToRepo: vi.fn().mockResolvedValue({}),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    await setupWorkspace.run(mockContext({ client }), { ...plan, existing_workspace_id: "ws_free" });

    expect(client.updateWorkspaceResources).not.toHaveBeenCalled();
  });

  it("surfaces a webhook warning from the link response", async () => {
    const client = mockClient({
      linkWorkspaceToRepo: vi.fn().mockResolvedValue({ warning: "no webhook" }),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      ...plan,
      existing_workspace_id: "ws_free",
    })) as any;

    expect(result.status).toBe("linked_with_warning");
    expect(result.warning).toBe("no webhook");
  });
});

describe("setup_workspace — cache", () => {
  it("forgets the cached repo of the workspace it just linked", async () => {
    const client = mockClient({
      linkWorkspaceToRepo: vi.fn().mockResolvedValue({}),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });
    const ctx = mockContext({ client });

    await setupWorkspace.run(ctx, { ...plan, existing_workspace_id: "ws_free" });

    expect(ctx.forgetWorkspaceRepo).toHaveBeenCalledWith("ws_free");
  });
});

describe("setup_workspace — create the repository first", () => {
  const created = {
    provider: "github",
    path: "acme/platform-network",
    name: "platform-network",
    default_branch: "main",
    visibility: "private",
    web_url: "https://github.com/acme/platform-network",
    clone_url: "https://github.com/acme/platform-network.git",
  };

  it("creates the repo as the user, links its default branch, and says how to add the remote", async () => {
    const client = mockClient({
      createVcsRepository: vi.fn().mockResolvedValue(created),
      createWorkspace: vi.fn().mockResolvedValue({
        workspace: { id: "ws_new" },
        repository_linked: true,
      }),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      connection_id: "conn_1",
      create_repo: true,
      repo_name: "platform-network",
      visibility: "private",
      repo_description: "Network baseline",
      workspace_name: "platform-network",
      ruleset_ids: ["rs_req"],
    })) as any;

    expect(client.createVcsRepository).toHaveBeenCalledWith("ent_1", "conn_1", {
      name: "platform-network",
      description: "Network baseline",
      visibility: "private",
    });
    // The link uses what the provider reported, not anything the agent guessed.
    expect(client.createWorkspace).toHaveBeenCalledWith(
      "ent_1",
      expect.objectContaining({
        repository: { connection_id: "conn_1", path: "acme/platform-network", branch: "main" },
      })
    );
    expect(result.status).toBe("linked");
    expect(result.repository).toEqual(created);
    expect(result.next).toContain("git remote add origin https://github.com/acme/platform-network.git");
    expect(result.next).toContain("git pull --rebase origin main");
    expect(result.next).toContain("trigger_compliance_evaluation");
  });

  it("can create the repo for an existing unlinked workspace", async () => {
    const client = mockClient({
      createVcsRepository: vi.fn().mockResolvedValue(created),
      linkWorkspaceToRepo: vi.fn().mockResolvedValue({}),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      connection_id: "conn_1",
      create_repo: true,
      repo_name: "platform-network",
      existing_workspace_id: "ws_free",
    })) as any;

    expect(client.linkWorkspaceToRepo).toHaveBeenCalledWith("ent_1", "ws_free", {
      connection_id: "conn_1",
      path: "acme/platform-network",
      branch: "main",
    });
    expect(result.repository.clone_url).toBe(created.clone_url);
  });

  it("refuses create_repo without a repo_name before touching anything", async () => {
    const client = mockClient();

    await expect(
      setupWorkspace.run(mockContext({ client }), {
        enterprise_id: "ent_1",
        connection_id: "conn_1",
        create_repo: true,
        workspace_name: "x",
      })
    ).rejects.toThrow(/repo_name/);
    expect(client.createVcsRepository).not.toHaveBeenCalled();
  });

  it("refuses a link without repo_path and branch when no repo is being created", async () => {
    const client = mockClient();

    await expect(
      setupWorkspace.run(mockContext({ client }), {
        enterprise_id: "ent_1",
        connection_id: "conn_1",
        workspace_name: "x",
      })
    ).rejects.toThrow(/repo_path and branch/);
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });

  it("lets the server's refusal through untouched when the provider cannot create as the user", async () => {
    const refusal = new Error(
      "infracodebase cannot create repositories on GitLab as you yet, and it never creates them with the enterprise connection."
    );
    const client = mockClient({ createVcsRepository: vi.fn().mockRejectedValue(refusal) });

    await expect(
      setupWorkspace.run(mockContext({ client }), {
        enterprise_id: "ent_1",
        connection_id: "conn_gl",
        create_repo: true,
        repo_name: "svc",
        workspace_name: "svc",
      })
    ).rejects.toBe(refusal);
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });
});

describe("setup_workspace — a created repository is never lost", () => {
  const created = {
    provider: "github",
    path: "acme/platform-network",
    name: "platform-network",
    default_branch: "main",
    visibility: "private",
    web_url: "https://github.com/acme/platform-network",
    clone_url: "https://github.com/acme/platform-network.git",
  };
  const createArgs = {
    enterprise_id: "ent_1",
    connection_id: "conn_1",
    create_repo: true,
    repo_name: "platform-network",
  };

  it("checks every argument before creating anything", async () => {
    const client = mockClient();

    await expect(setupWorkspace.run(mockContext({ client }), createArgs)).rejects.toThrow(
      /workspace_name/
    );
    await expect(
      setupWorkspace.run(mockContext({ client }), {
        ...createArgs,
        workspace_name: "x",
        repo_path: "acme/other",
        branch: "main",
      })
    ).rejects.toThrow(/omit repo_path and branch/);
    await expect(
      setupWorkspace.run(mockContext({ client }), {
        enterprise_id: "ent_1",
        connection_id: "conn_1",
        repo_path: "acme/other",
        branch: "main",
        repo_name: "stray",
        workspace_name: "x",
      })
    ).rejects.toThrow(/only apply with create_repo/);
    expect(client.createVcsRepository).not.toHaveBeenCalled();
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });

  it("keeps the repository and says to link it when the workspace step throws", async () => {
    const client = mockClient({
      createVcsRepository: vi.fn().mockResolvedValue(created),
      createWorkspace: vi.fn().mockRejectedValue(new Error("409 a workspace already owns this repo")),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      ...createArgs,
      workspace_name: "platform-network",
    })) as any;

    expect(result.status).toBe("repository_created_but_setup_failed");
    expect(result.repository).toEqual(created);
    expect(result.error).toContain("409");
    expect(result.next).toContain("Do not pass create_repo again");
    expect(result.next).toContain('repo_path "acme/platform-network"');
    expect(result.next).toContain("git remote add origin https://github.com/acme/platform-network.git");
  });

  it("tells the agent to link, not recreate, when the link fails after creation", async () => {
    const client = mockClient({
      createVcsRepository: vi.fn().mockResolvedValue(created),
      createWorkspace: vi.fn().mockResolvedValue({
        workspace: { id: "ws_new" },
        repository_linked: false,
        repository_error: "clone failed",
      }),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    const result = (await setupWorkspace.run(mockContext({ client }), {
      ...createArgs,
      workspace_name: "platform-network",
    })) as any;

    expect(result.status).toBe("workspace_ready_but_link_failed");
    expect(result.repository).toEqual(created);
    expect(result.next).toContain("Do not pass create_repo again");
    expect(result.next).not.toContain("push an initial commit");
  });
});
