/**
 * REST API client for infracodebase
 *
 * Calls the public /api/v1 endpoints with authentication.
 */

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
      "User-Agent": "@infracodebase/mcp/1.0.0",
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
   * Fetch full workspace context (identity, rulesets, guidelines, compliance,
   * modules) for a known enterprise + workspace. Goes through the shared
   * request() path so it gets ApiError handling like every other call.
   */
  async getWorkspaceContext(enterpriseId: string, workspaceId: string, iacTool?: string) {
    const path =
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}/context` +
      (iacTool ? `?iac_tool=${encodeURIComponent(iacTool)}` : "");

    return this.request<unknown>("GET", path);
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

  async listWorkspaces(enterpriseId: string) {
    return this.request<{ data: Array<unknown> }>(
      "GET",
      `/enterprises/${enterpriseId}/workspaces`
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

  // ---------------------------------------------------------------------------
  // Compliance operations
  // ---------------------------------------------------------------------------

  async getComplianceEvaluation(enterpriseId: string, workspaceId: string, ref?: string) {
    const path = ref
      ? `/enterprises/${enterpriseId}/workspaces/${workspaceId}/compliance/evaluations/${ref}`
      : `/enterprises/${enterpriseId}/workspaces/${workspaceId}/compliance/evaluations/latest`;

    return this.request<unknown>("GET", path);
  }

  async listComplianceFindings(
    enterpriseId: string,
    workspaceId: string,
    params?: { ref?: string; status?: string }
  ) {
    const searchParams = new URLSearchParams();
    if (params?.ref) searchParams.set("ref", params.ref);
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    const path =
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}/compliance/findings` +
      (query ? `?${query}` : "");

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
  // GitHub operations
  // ---------------------------------------------------------------------------

  async listGitHubInstallations(enterpriseId: string) {
    return this.request<unknown>(
      "GET",
      `/enterprises/${enterpriseId}/integrations/github/installations`
    );
  }

  async listGitHubRepos(enterpriseId: string, installationId: string, search?: string) {
    const searchParams = new URLSearchParams();
    if (search) searchParams.set("search", search);
    const query = searchParams.toString();
    const path =
      `/enterprises/${enterpriseId}/integrations/github/installations/${installationId}/repos` +
      (query ? `?${query}` : "");

    return this.request<unknown>("GET", path);
  }

  // ---------------------------------------------------------------------------
  // Repository operations
  // ---------------------------------------------------------------------------

  async linkWorkspaceToRepo(
    enterpriseId: string,
    workspaceId: string,
    params: {
      installation_id: string;
      owner: string;
      repo: string;
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
      `/enterprises/${enterpriseId}/workspaces/${workspaceId}`,
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
