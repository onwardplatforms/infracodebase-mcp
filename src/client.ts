/**
 * REST API client for infracodebase
 *
 * Calls the public /api/v1 endpoints with authentication.
 */

import { VERSION } from "./version.js";

export interface ClientConfig {
  baseUrl: string;
  token: string;
}

export class InfracodebaseClient {
  private baseUrl: string;
  private token: string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.token = config.token;
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
    }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "User-Agent": `@infracodebase/mcp/${VERSION}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(response.status, errorText, path, this.baseUrl);
    }

    return (await response.json()) as T;
  }

  // ---------------------------------------------------------------------------
  // Workspace operations
  // ---------------------------------------------------------------------------

  /**
   * Resolve full workspace context (identity, rulesets, guidelines,
   * compliance, modules) from a repo_url or workspace_id — exactly one is
   * required. Server-side resolution: no enterprise ID needed upfront, no
   * client-side enumerate-and-match. Response `status` is one of `linked`,
   * `unlinked`, `no_access`, or `ambiguous`.
   */
  async resolveWorkspaceContext(params: {
    repoUrl?: string;
    workspaceId?: string;
    iacTool?: string;
  }) {
    const query = new URLSearchParams();
    if (params.repoUrl) query.set("repo_url", params.repoUrl);
    if (params.workspaceId) query.set("workspace_id", params.workspaceId);
    if (params.iacTool) query.set("iac_tool", params.iacTool);
    const qs = query.toString();

    return this.request<unknown>("GET", `/workspace-context${qs ? `?${qs}` : ""}`);
  }

  async listEnterprises() {
    return this.request<{ data: Array<unknown> }>("GET", "/enterprises");
  }

  /**
   * Verify the token works by hitting an authenticated endpoint.
   * Returns the caller's enterprises so the CLI can confirm who they are.
   * Throws ApiError (401/403/...) on an invalid or expired token.
   */
  async verifyToken(): Promise<Array<{ id?: string; name?: string }>> {
    const res = await this.listEnterprises();
    return (res.data as Array<{ id?: string; name?: string }>) ?? [];
  }

  async listWorkspaces(enterpriseId: string, kinds?: string[]) {
    const query = kinds?.length ? `?kinds=${encodeURIComponent(kinds.join(","))}` : "";
    return this.request<{ data: Array<unknown> }>(
      "GET",
      `/enterprises/${enterpriseId}/workspaces${query}`
    );
  }

  async createWorkspace(enterpriseId: string, body: unknown) {
    return this.request<unknown>("POST", `/enterprises/${enterpriseId}/workspaces`, {
      body,
    });
  }

  // ---------------------------------------------------------------------------
  // Ruleset operations
  // ---------------------------------------------------------------------------

  async getRulesetDetails(enterpriseId: string, rulesetId: string) {
    return this.request<unknown>("GET", `/enterprises/${enterpriseId}/rulesets/${rulesetId}`);
  }

  /**
   * List every ruleset relevant to a workspace — enterprise rulesets
   * (required and optional, including optional ones the workspace hasn't
   * opted into), workspace-owned, and the caller's personal rulesets. Each
   * row carries `workspace_setting` (the workspace's stored opinion, or
   * null if it's never opted in/out) and `effective_enabled` (the computed
   * active state). Use this to find a ruleset that exists in the enterprise
   * catalog but isn't currently active for this workspace.
   */
  async listWorkspaceRulesets(enterpriseId: string, workspaceId: string) {
    return this.request<{ data: Array<unknown> }>(
      "GET",
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}/rulesets`
    );
  }

  // ---------------------------------------------------------------------------
  // Compliance operations
  // ---------------------------------------------------------------------------

  /**
   * `branch` only applies when `ref` is omitted — it scopes "latest" to a
   * branch (server falls back to the workspace's default branch, then to
   * the most recent completed evaluation on any branch).
   */
  async getComplianceEvaluation(
    enterpriseId: string,
    workspaceId: string,
    ref?: string,
    branch?: string
  ) {
    const path = ref
      ? `/enterprises/${enterpriseId}/workspaces/${workspaceId}/compliance/evaluations/${ref}`
      : `/enterprises/${enterpriseId}/workspaces/${workspaceId}/compliance/evaluations/latest` +
        (branch ? `?branch=${encodeURIComponent(branch)}` : "");

    return this.request<unknown>("GET", path);
  }

  /**
   * Trigger a compliance evaluation. With no scoping params, runs a full
   * evaluation. Pass `ruleset_id`, `rule_id`, or `rule_ids` to scope the run
   * to just those rules — other rules' findings carry forward from the
   * rollforward baseline unchanged. Fire-and-forget on the server: returns
   * the queued/running evaluation summary immediately. Check status later via
   * getComplianceEvaluation — don't tight-loop it.
   */
  async triggerComplianceEvaluation(
    enterpriseId: string,
    workspaceId: string,
    body: {
      ref?: string;
      ruleset_id?: string;
      rule_id?: string;
      rule_ids?: string[];
    }
  ) {
    return this.request<unknown>(
      "POST",
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}/compliance/evaluations`,
      { body }
    );
  }

  async listComplianceFindings(
    enterpriseId: string,
    workspaceId: string,
    params?: { ref?: string; status?: string }
  ) {
    // Findings are nested under an evaluation. A ref (evaluation id or commit
    // SHA) targets that evaluation; with no ref we hit the `latest` alias,
    // which the API resolves to the latest completed evaluation server-side —
    // one request either way, no client-side id resolution.
    const evalRef = params?.ref ? encodeURIComponent(params.ref) : "latest";
    const query = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
    const path =
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}/compliance/evaluations/${evalRef}/findings` +
      query;

    return this.request<unknown>("GET", path);
  }

  async getComplianceEvalSpec(enterpriseId: string, workspaceId: string) {
    return this.request<unknown>(
      "GET",
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}/compliance/eval-spec`
    );
  }

  // ---------------------------------------------------------------------------
  // Enterprise resources
  // ---------------------------------------------------------------------------

  async listEnterpriseResources(enterpriseId: string) {
    return this.request<unknown>("GET", `/enterprises/${enterpriseId}/resources`);
  }

  async listModules(enterpriseId: string) {
    return this.request<unknown>("GET", `/enterprises/${enterpriseId}/modules`);
  }

  // ---------------------------------------------------------------------------
  // Version-control operations
  // ---------------------------------------------------------------------------

  /** Every connected source (GitHub orgs, GitLab connections, …), each
   *  addressable by connection id. Optional provider key filters the list. */
  async listVcsConnections(enterpriseId: string, provider?: string) {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
    return this.request<unknown>(
      "GET",
      `/enterprises/${enterpriseId}/integrations/vcs/connections${query}`
    );
  }

  /** Repositories a connection can reach — identical shape for every provider.
   *  Each repo carries its full provider `path` (GitLab subgroups included). */
  async listVcsRepos(enterpriseId: string, connectionId: string, search?: string) {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    const path =
      `/enterprises/${enterpriseId}/integrations/vcs/connections/${connectionId}/repos` + query;

    return this.request<unknown>("GET", path);
  }

  // ---------------------------------------------------------------------------
  // Repository operations
  // ---------------------------------------------------------------------------

  async linkWorkspaceToRepo(
    enterpriseId: string,
    workspaceId: string,
    params: {
      connection_id: string;
      path: string;
      branch: string;
    }
  ) {
    return this.request<unknown>(
      "PUT",
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}/repository`,
      {
        body: params,
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Workspace updates
  // ---------------------------------------------------------------------------

  async updateWorkspaceResources(
    enterpriseId: string,
    workspaceId: string,
    updates: {
      add_ruleset_ids?: string[];
      remove_ruleset_ids?: string[];
      add_mcp_server_ids?: string[];
      remove_mcp_server_ids?: string[];
      add_workflow_ids?: string[];
      remove_workflow_ids?: string[];
    }
  ) {
    return this.request<unknown>(
      "PATCH",
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}/resources`,
      {
        body: updates,
      }
    );
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
    public baseUrl = ""
  ) {
    // Include the host so a misconfigured API URL is diagnosable from the message.
    super(`API request failed: ${status} ${baseUrl}${path}\n${body}`);
    this.name = "ApiError";
  }
}
