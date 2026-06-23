/**
 * Tool registry — registers every MCP tool on the McpServer.
 *
 * McpServer.registerTool(name, { description, inputSchema }, handler) handles the
 * tools/list and tools/call wiring, generates the JSON Schema from the Zod shape,
 * and validates arguments before the handler runs. We just supply the shapes
 * (from validation.ts) and the per-tool logic.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { TOOL_SHAPES, TOOL_DESCRIPTIONS, parseRepoUrl, type ToolName } from "./validation.js";

/** Minimal shape we rely on from a workspace list entry. */
interface WorkspaceEntry {
  id: string;
  enterprise_id: string;
  repo?: { owner?: string; name?: string } | null;
}

type Args = Record<string, any>;

function asText(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function asError(err: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  };
}

/**
 * Register all MCP tools.
 */
export async function registerAllTools(server: McpServer, context: ServerContext) {
  const { client, workspaceEnterpriseMap } = context;

  /**
   * List every workspace across every accessible enterprise, tagged with its
   * enterprise_id. Enterprises are scanned concurrently and each list call is
   * cache-backed. Also warms the workspace→enterprise map as a side effect.
   */
  async function listAllWorkspaces(): Promise<WorkspaceEntry[]> {
    const enterprises = (await client.listEnterprises()).data as Array<{ id: string }>;
    const perEnterprise = await Promise.all(
      enterprises.map(async (e) => {
        const workspaces = (await client.listWorkspaces(e.id)).data as Array<
          Omit<WorkspaceEntry, "enterprise_id">
        >;
        return workspaces.map((w) => ({ ...w, enterprise_id: e.id }));
      })
    );
    const all = perEnterprise.flat();
    for (const w of all) workspaceEnterpriseMap.set(w.id, w.enterprise_id);
    return all;
  }

  /**
   * Resolve the enterprise that owns a workspace. Prefers (in order): an
   * explicit hint, the warm in-memory map, then a full scan.
   */
  async function getEnterpriseForWorkspace(workspaceId: string, hint?: string): Promise<string> {
    if (hint) return hint;
    const cached = workspaceEnterpriseMap.get(workspaceId);
    if (cached) return cached;

    await listAllWorkspaces(); // warms the map
    const found = workspaceEnterpriseMap.get(workspaceId);
    if (found) return found;

    throw new Error(
      `Workspace ${workspaceId} not found in any accessible enterprise. ` +
        `Use list_workspaces to find valid workspace IDs.`
    );
  }

  /** Find the workspace linked to a git repo URL, or null if none matches. */
  async function resolveWorkspaceByRepo(repoUrl: string): Promise<WorkspaceEntry | null> {
    const target = parseRepoUrl(repoUrl);
    if (!target) {
      throw new Error(
        `Could not parse repo URL "${repoUrl}". Expected forms like ` +
          `https://github.com/owner/name, git@github.com:owner/name, or owner/name.`
      );
    }
    const all = await listAllWorkspaces();
    return (
      all.find(
        (w) =>
          w.repo &&
          w.repo.owner?.toLowerCase() === target.owner &&
          w.repo.name?.toLowerCase() === target.name
      ) ?? null
    );
  }

  /** Register a tool: shared try/catch + JSON formatting around the handler. */
  function add(name: ToolName, run: (args: Args) => Promise<unknown>): void {
    server.registerTool(
      name,
      { description: TOOL_DESCRIPTIONS[name], inputSchema: TOOL_SHAPES[name] },
      async (args: Args) => {
        try {
          return asText(await run(args));
        } catch (err) {
          return asError(err);
        }
      }
    );
  }

  // --- Workspace tools ---
  add("list_enterprises", () => client.listEnterprises());

  add("list_workspaces", (a) => client.listWorkspaces(a.enterprise_id));

  add("get_workspace_context", async (a) => {
    let workspaceId: string;
    let enterpriseId: string;

    if (a.workspace_id) {
      workspaceId = a.workspace_id;
      enterpriseId = await getEnterpriseForWorkspace(workspaceId, a.enterprise_id);
    } else if (a.repo_url) {
      const ws = await resolveWorkspaceByRepo(a.repo_url);
      if (!ws) {
        return {
          status: "unlinked",
          repo_url: a.repo_url,
          message:
            "No workspace is linked to this repo. Use list_workspaces to find one, " +
            "or link_workspace_to_repo to connect it.",
        };
      }
      workspaceId = ws.id;
      enterpriseId = ws.enterprise_id;
    } else {
      throw new Error("Provide either workspace_id or repo_url.");
    }

    return client.getWorkspaceContext(enterpriseId, workspaceId, a.iac_tool);
  });

  // --- Ruleset tools ---
  add("get_ruleset_details", async (a) => {
    const enterpriseId = await getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return client.getRulesetDetails(enterpriseId, a.ruleset_id);
  });

  // --- Compliance tools ---
  add("get_compliance_evaluation", async (a) => {
    const enterpriseId = await getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return client.getComplianceEvaluation(enterpriseId, a.workspace_id, a.ref);
  });

  add("list_compliance_findings", async (a) => {
    const enterpriseId = await getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return client.listComplianceFindings(enterpriseId, a.workspace_id, {
      ref: a.ref,
      status: a.status,
    });
  });

  add("get_compliance_eval_spec", async (a) => {
    const enterpriseId = await getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return client.getComplianceEvalSpec(enterpriseId, a.workspace_id);
  });

  // --- Enterprise resource tools ---
  add("list_enterprise_resources", (a) => client.listEnterpriseResources(a.enterprise_id));

  add("list_modules", (a) => client.listModules(a.enterprise_id));

  // --- GitHub tools ---
  add("list_github_installations", (a) => client.listGitHubInstallations(a.enterprise_id));

  add("list_github_repos", (a) =>
    client.listGitHubRepos(a.enterprise_id, a.installation_id, a.search)
  );

  add("create_workspace", (a) => {
    const body: Record<string, unknown> = {
      name: a.name,
      description: a.description,
      ruleset_ids: a.ruleset_ids,
      mcp_server_ids: a.mcp_server_ids,
      workflow_ids: a.workflow_ids,
    };

    if (a.github_installation_id && a.github_owner && a.github_repo && a.github_branch) {
      body.github = {
        installation_id: a.github_installation_id,
        owner: a.github_owner,
        repo: a.github_repo,
        branch: a.github_branch,
      };
    }

    return client.createWorkspace(a.enterprise_id, body);
  });

  add("link_workspace_to_repo", async (a) => {
    const enterpriseId = await getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return client.linkWorkspaceToRepo(enterpriseId, a.workspace_id, {
      installation_id: a.github_installation_id,
      owner: a.github_owner,
      repo: a.github_repo,
      branch: a.github_branch,
    });
  });

  add("update_workspace_resources", async (a) => {
    const enterpriseId = await getEnterpriseForWorkspace(a.workspace_id, a.enterprise_id);
    return client.updateWorkspaceResources(enterpriseId, a.workspace_id, {
      add_ruleset_ids: a.add_ruleset_ids,
      remove_ruleset_ids: a.remove_ruleset_ids,
      add_mcp_server_ids: a.add_mcp_server_ids,
      remove_mcp_server_ids: a.remove_mcp_server_ids,
      add_workflow_ids: a.add_workflow_ids,
      remove_workflow_ids: a.remove_workflow_ids,
    });
  });
}
