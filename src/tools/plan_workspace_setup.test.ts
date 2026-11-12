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

describe("plan_workspace_setup — the repository does not exist yet", () => {
  const creatable = (id: string, account = "acme", repository_creation = "available") => ({
    ...conn(id, account),
    account_type: "Organization",
    repository_creation,
    allowed_visibilities: ["private", "internal"],
  });

  function enterpriseClient(connections: unknown[]) {
    return mockClient({
      listEnterprises: vi.fn().mockResolvedValue({ data: [ent("ent_1", "Acme")] }),
      listVcsConnections: vi.fn().mockResolvedValue({ data: connections }),
      listWorkspaces: vi.fn().mockResolvedValue({
        data: [{ id: "ws_free", name: "Sandbox", slug: "sandbox", description: null, linked_repository: null }],
      }),
      listEnterpriseResources: vi.fn().mockResolvedValue({
        rulesets: [
          { id: "rs_req", name: "Baseline", required: true },
          { id: "rs_opt", name: "S3", required: false },
        ],
      }),
    });
  }

  it("proposes creating the repo through setup_workspace when the one target can create as the user", async () => {
    // An empty directory: the default context resolver throws (no remote).
    const client = enterpriseClient([creatable("conn_1")]);

    const result = (await planWorkspaceSetup.run(mockContext({ client }), {
      repo_name: "platform-network",
    })) as any;

    expect(result.status).toBe("no_remote");
    expect(result.repo).toMatchObject({ url: null, resolved_from: null });
    expect(result.targets).toHaveLength(1);
    expect(result.target).toMatchObject({
      enterprise_id: "ent_1",
      connection_id: "conn_1",
      repository_creation: "available",
      create: { how: "setup_workspace" },
    });
    expect(result.proposed).toEqual({
      action: "create_repository_and_workspace",
      repo_name: "platform-network",
      visibility: "private",
      workspace_name: "platform-network",
      ruleset_ids: ["rs_req"],
    });
    expect(result.decisions_needed.map((d: any) => d.decision)).toEqual([
      "visibility",
      "workspace",
      "rulesets",
    ]);
    expect(result.next).toContain("create_repo true");
    expect(result.next).toContain("Do not call setup_workspace until they have");
    // The repo search never runs: there is no path to look for.
    expect(client.listVcsRepos).not.toHaveBeenCalled();
  });

  it("asks for the repository name when none was given", async () => {
    const client = enterpriseClient([creatable("conn_1")]);

    const result = (await planWorkspaceSetup.run(mockContext({ client }), {})) as any;

    expect(result.status).toBe("no_remote");
    expect(result.decisions_needed[0].decision).toBe("repository_name");
    expect(result.proposed.repo_name).toBeUndefined();
  });

  it("tells the agent to have the user create it in the provider when the target cannot create as the user", async () => {
    const client = enterpriseClient([
      { ...conn("conn_gl", "acme-group"), provider: "gitlab", repository_creation: "unsupported_provider" },
    ]);

    const result = (await planWorkspaceSetup.run(mockContext({ client }), {
      repo_name: "platform-network",
    })) as any;

    expect(result.status).toBe("no_remote");
    expect(result.target.create).toEqual({
      how: "provider",
      command: "glab repo create acme-group/platform-network --private",
      instructions: expect.stringContaining("never creates them with the enterprise connection"),
    });
    expect(result.next).toContain("glab repo create acme-group/platform-network --private");
    expect(result.next).toContain("plan_workspace_setup again");
    // No plan is built for a target infracodebase cannot create through.
    expect(client.listEnterpriseResources).not.toHaveBeenCalled();
    expect(result.proposed).toBeUndefined();
  });

  it("names the missing GitHub connection as the fix, not the provider", async () => {
    const client = enterpriseClient([creatable("conn_1", "acme", "connect_github_account")]);

    const result = (await planWorkspaceSetup.run(mockContext({ client }), {
      repo_name: "svc",
    })) as any;

    expect(result.target.create.how).toBe("provider");
    expect(result.next).toContain("Settings → Connections");
    expect(result.next).toContain("gh repo create acme/svc --private");
  });

  it("turns several possible homes into a target decision, preferring ones infracodebase can create through", async () => {
    const client = enterpriseClient([
      creatable("conn_1"),
      { ...conn("conn_gl", "acme-group"), provider: "gitlab", repository_creation: "unsupported_provider" },
    ]);

    const result = (await planWorkspaceSetup.run(mockContext({ client }), {
      repo_name: "svc",
    })) as any;

    expect(result.status).toBe("no_remote");
    expect(result.decisions_needed).toEqual([
      expect.objectContaining({
        decision: "target",
        options: [
          expect.objectContaining({ connection_id: "conn_1", repository_creation: "available" }),
          expect.objectContaining({ connection_id: "conn_gl", repository_creation: "unsupported_provider" }),
        ],
      }),
    ]);
    expect(result.next).toContain("enterprise_id and connection_id, plus repo_name");
  });

  it("narrows to the chosen target on the second pass", async () => {
    const client = enterpriseClient([
      creatable("conn_1"),
      { ...conn("conn_gl", "acme-group"), provider: "gitlab", repository_creation: "unsupported_provider" },
    ]);

    const result = (await planWorkspaceSetup.run(mockContext({ client }), {
      enterprise_id: "ent_1",
      connection_id: "conn_1",
      repo_name: "svc",
    })) as any;

    expect(result.targets).toHaveLength(1);
    expect(result.proposed.action).toBe("create_repository_and_workspace");
  });

  it("offers the same targets for a remote no connection can see, named after the remote", async () => {
    const client = enterpriseClient([creatable("conn_1")]);
    client.resolveWorkspaceContext = vi
      .fn()
      .mockResolvedValue({ status: "unlinked", owner: "acme", name: "infra" });
    client.listVcsRepos = vi.fn().mockResolvedValue({ data: [] });

    const result = (await planWorkspaceSetup.run(ctxWith(client), {})) as any;

    expect(result.status).toBe("repo_not_found");
    expect(result.scanned).toHaveLength(1);
    expect(result.targets).toHaveLength(1);
    expect(result.proposed).toMatchObject({
      action: "create_repository_and_workspace",
      repo_name: "infra",
    });
  });

  it("says when no connection could hold the repository at all", async () => {
    const client = enterpriseClient([]);

    const result = (await planWorkspaceSetup.run(mockContext({ client }), { repo_name: "svc" })) as any;

    expect(result.status).toBe("no_remote");
    expect(result.targets).toEqual([]);
    expect(result.next).toContain("Settings → Version control");
  });

  it("still fails loudly when repo_url was given but names nothing resolvable", async () => {
    const client = enterpriseClient([creatable("conn_1")]);
    const ctx = mockContext({
      client,
      resolveRepoUrl: vi.fn(async () => {
        throw new Error("Could not parse repo_url");
      }),
    });

    await expect(planWorkspaceSetup.run(ctx, { repo_url: "nonsense" })).rejects.toThrow(
      /Could not parse repo_url/
    );
  });
});
