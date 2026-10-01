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
