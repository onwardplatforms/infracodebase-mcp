import { describe, it, expect, vi } from "vitest";
import { planWorkspaceSetup } from "./plan_workspace_setup.js";
import { mockClient, mockContext } from "../test-helpers.js";

const ent = (id: string, name = id) => ({ id, name, slug: id });
const conn = (id: string, account = "acme") => ({ id, provider: "github", host: "github.com", account });
const repo = (path: string, default_branch = "main") => ({
  path,
  name: path.split("/").pop(),
  default_branch,
  web_url: `https://github.com/${path}`,
});

/** A context whose detector reports the argument as given (or a cwd-detected URL). */
function ctxWith(client: ReturnType<typeof mockClient>) {
  return mockContext({
    client,
    resolveRepoUrl: vi.fn(async (explicit?: string) => ({
      repo_url: explicit ?? "https://github.com/acme/infra.git",
      resolved_from: explicit ? ("argument" as const) : ("cwd" as const),
    })),
  });
}

describe("plan_workspace_setup — short-circuits", () => {
  it("reports already_linked without any further lookups when the repo is governed", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({
        status: "linked",
        workspace: { id: "ws_1", name: "Infra" },
      }),
    });

    const result = await planWorkspaceSetup.run(ctxWith(client), { repo_url: "acme/infra" });

    expect(result).toMatchObject({
      status: "already_linked",
      repo: { url: "acme/infra", resolved_from: "argument" },
      workspace: { id: "ws_1" },
    });
    expect(client.listEnterprises).not.toHaveBeenCalled();
  });

  it("passes no_access and ambiguous through with their message and candidates", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi.fn().mockResolvedValue({
        status: "ambiguous",
        message: "pick one",
        candidates: [{ workspace_id: "ws_1" }],
      }),
    });

    const result = await planWorkspaceSetup.run(ctxWith(client), {});

    expect(result).toMatchObject({
      status: "ambiguous",
      message: "pick one",
      candidates: [{ workspace_id: "ws_1" }],
      repo: { resolved_from: "cwd" },
    });
    expect(client.listEnterprises).not.toHaveBeenCalled();
  });
});

describe("plan_workspace_setup — a single match", () => {
  function happyClient() {
    return mockClient({
      resolveWorkspaceContext: vi
        .fn()
        .mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" }),
      listEnterprises: vi.fn().mockResolvedValue({ data: [ent("ent_1", "Acme")] }),
      listVcsConnections: vi.fn().mockResolvedValue({ data: [conn("conn_1")] }),
      listVcsRepos: vi
        .fn()
        .mockResolvedValue({ data: [repo("acme/infra"), repo("acme/infra-old")] }),
      listWorkspaces: vi.fn().mockResolvedValue({
        data: [
          { id: "ws_linked", name: "Other", linked_repository: { owner: "acme", name: "other" } },
          { id: "ws_free", name: "Sandbox", slug: "sandbox", description: null, linked_repository: null },
        ],
      }),
      listEnterpriseResources: vi.fn().mockResolvedValue({
        rulesets: [
          { id: "rs_req", name: "Baseline", description: "Always on", required: true },
          { id: "rs_opt", name: "S3", description: "Buckets", required: false },
        ],
        mcp_servers: [],
        workflows: [],
      }),
    });
  }

  it("returns a ready plan with required rulesets pre-selected and the user's decisions listed", async () => {
    const client = happyClient();

    const result = (await planWorkspaceSetup.run(ctxWith(client), {})) as any;

    // The repo search is scoped by name, and the path match is exact.
    expect(client.listVcsRepos).toHaveBeenCalledWith("ent_1", "conn_1", "infra");
    expect(client.listWorkspaces).toHaveBeenCalledWith("ent_1", ["STANDARD", "TEMPLATE", "MODULE"]);

    expect(result.status).toBe("ready");
    expect(result.repo).toMatchObject({
      url: "https://github.com/acme/infra.git",
      resolved_from: "cwd",
      path: "acme/infra",
      default_branch: "main",
    });
    expect(result.enterprise).toEqual({ id: "ent_1", name: "Acme", slug: "ent_1" });
    expect(result.connection).toMatchObject({ id: "conn_1", provider: "github" });
    expect(result.proposed).toEqual({
      action: "create_workspace",
      workspace_name: "infra",
      branch: "main",
      ruleset_ids: ["rs_req"],
    });
    expect(result.rulesets.required.map((r: any) => r.id)).toEqual(["rs_req"]);
    expect(result.rulesets.optional.map((r: any) => r.id)).toEqual(["rs_opt"]);
    // Only workspaces without a repo are offered as link targets.
    expect(result.existing_unlinked_workspaces).toEqual([
      { id: "ws_free", name: "Sandbox", slug: "sandbox", description: null },
    ]);
    expect(result.decisions_needed.map((d: any) => d.decision)).toEqual(["workspace", "rulesets"]);
    expect(result.next).toContain("Do not call setup_workspace until they have");
    expect(result.next).toContain('repo_path "acme/infra"');
  });

  it("asks for a branch when the provider reports none (empty repo)", async () => {
    const client = happyClient();
    client.listVcsRepos.mockResolvedValue({ data: [{ ...repo("acme/infra"), default_branch: "" }] });

    const result = (await planWorkspaceSetup.run(ctxWith(client), {})) as any;

    expect(result.proposed.branch).toBe("main");
    expect(result.decisions_needed.map((d: any) => d.decision)).toContain("branch");
  });

  it("reports already_linked when the workspace list shows a workspace owning the repo", async () => {
    const client = happyClient();
    client.listWorkspaces.mockResolvedValue({
      data: [{ id: "ws_owner", name: "Infra", slug: "infra", linked_repository: { owner: "ACME", name: "infra" } }],
    });

    const result = await planWorkspaceSetup.run(ctxWith(client), {});

    expect(result).toMatchObject({ status: "already_linked", workspace: { id: "ws_owner" } });
  });
});

describe("plan_workspace_setup — no match or several", () => {
  it("returns needs_decision with one option per (enterprise, connection) that sees the repo", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi
        .fn()
        .mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" }),
      listEnterprises: vi.fn().mockResolvedValue({ data: [ent("ent_1", "Acme"), ent("ent_2", "Acme EU")] }),
      listVcsConnections: vi
        .fn()
        .mockImplementation(async (eid: string) => ({ data: [conn(`conn_${eid}`)] })),
      listVcsRepos: vi.fn().mockResolvedValue({ data: [repo("acme/infra")] }),
    });

    const result = (await planWorkspaceSetup.run(ctxWith(client), {})) as any;

    expect(result.status).toBe("needs_decision");
    expect(result.decisions_needed[0].decision).toBe("connection");
    expect(result.decisions_needed[0].options.map((o: any) => o.enterprise_id).sort()).toEqual([
      "ent_1",
      "ent_2",
    ]);
    expect(result.next).toContain("enterprise_id and connection_id");
    // No plan is built until the user has chosen.
    expect(client.listEnterpriseResources).not.toHaveBeenCalled();
  });

  it("narrows to the given enterprise_id and connection_id on the second pass", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi
        .fn()
        .mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" }),
      listEnterprises: vi.fn().mockResolvedValue({ data: [ent("ent_1"), ent("ent_2")] }),
      listVcsConnections: vi.fn().mockResolvedValue({ data: [conn("conn_a"), conn("conn_b")] }),
      listVcsRepos: vi.fn().mockResolvedValue({ data: [repo("acme/infra")] }),
      listWorkspaces: vi.fn().mockResolvedValue({ data: [] }),
      listEnterpriseResources: vi.fn().mockResolvedValue({ rulesets: [] }),
    });

    const result = (await planWorkspaceSetup.run(ctxWith(client), {
      enterprise_id: "ent_2",
      connection_id: "conn_b",
    })) as any;

    expect(client.listVcsConnections).toHaveBeenCalledTimes(1);
    expect(client.listVcsRepos).toHaveBeenCalledWith("ent_2", "conn_b", "infra");
    expect(result).toMatchObject({ status: "ready", enterprise: { id: "ent_2" }, connection: { id: "conn_b" } });
  });

  it("returns repo_not_found with what it scanned and similarly named repos elsewhere", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi
        .fn()
        .mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" }),
      listEnterprises: vi.fn().mockResolvedValue({ data: [ent("ent_1")] }),
      listVcsConnections: vi.fn().mockResolvedValue({ data: [conn("conn_1", "acme-forks")] }),
      listVcsRepos: vi.fn().mockResolvedValue({ data: [repo("acme-forks/infra")] }),
    });

    const result = (await planWorkspaceSetup.run(ctxWith(client), {})) as any;

    expect(result.status).toBe("repo_not_found");
    expect(result.repo.path).toBe("acme/infra");
    expect(result.scanned).toEqual([
      { enterprise_id: "ent_1", connection_id: "conn_1", provider: "github", account: "acme-forks", repos_matching_name: 1 },
    ]);
    expect(result.similar).toEqual([
      { enterprise_id: "ent_1", connection_id: "conn_1", path: "acme-forks/infra", web_url: "https://github.com/acme-forks/infra" },
    ]);
    expect(result.next).toContain("gh repo create");
  });

  it("rejects an enterprise_id the token cannot see instead of silently planning nothing", async () => {
    const client = mockClient({
      resolveWorkspaceContext: vi
        .fn()
        .mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" }),
      listEnterprises: vi.fn().mockResolvedValue({ data: [ent("ent_1")] }),
    });

    await expect(planWorkspaceSetup.run(ctxWith(client), { enterprise_id: "ent_nope" })).rejects.toThrow(
      /ent_nope is not an enterprise this token can access/
    );
    expect(client.listVcsConnections).not.toHaveBeenCalled();
  });
});
