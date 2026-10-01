/**
 * Shared plumbing for the per-tool modules.
 *
 * Each tool lives in its own file and exports a `ToolDef` (see the sibling
 * `*.ts` files and the registry in `index.ts`). This module owns the things
 * every tool needs but shouldn't re-implement:
 *
 *   - `ToolContext` — the API client, the workspace→enterprise resolution
 *     helpers, and the repo auto-detector, built once per server via
 *     `createToolContext`.
 *   - `registerTool` — wires a `ToolDef` onto the McpServer with a shared
 *     try/catch and JSON formatting. Description, input schema, and
 *     annotations come from `validation.ts` by name, so the tools/list output
 *     and argument validation stay in one place.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { InfracodebaseClient } from "../client.js";
import type { ServerContext } from "../server.js";
import { createRepoResolver, gitRemoteUrl, type ResolvedRepo } from "../repo-detect.js";
import { TOOL_SHAPES, TOOL_DESCRIPTIONS, TOOL_ANNOTATIONS, type ToolName } from "./validation.js";

export type Args = Record<string, any>;

/** Minimal shape we rely on from a workspace list entry. */
export interface WorkspaceEntry {
  id: string;
  enterprise_id: string;
  repo?: { owner?: string; name?: string } | null;
}

/**
 * Everything a tool handler is handed: the API client plus the shared
 * resolution helpers. Built once per server so the helpers share one warm
 * workspace→enterprise map.
 */
export interface ToolContext {
  client: InfracodebaseClient;
  /** List every workspace across every accessible enterprise (cache-backed). */
  listAllWorkspaces(): Promise<WorkspaceEntry[]>;
  /** Resolve the enterprise that owns a workspace, preferring a hint then the cache. */
  getEnterpriseForWorkspace(workspaceId: string, hint?: string): Promise<string>;
  /**
   * The repo to act on: an explicit argument, else the client's workspace
   * roots, else the server's working directory. Throws with the directories
   * it checked when none has a git remote.
   */
  resolveRepoUrl(explicit?: string): Promise<ResolvedRepo>;
}

/**
 * A single MCP tool: its registered name and the handler logic. The input
 * schema, description, and annotations are looked up from `validation.ts` by
 * name, so a tool file only carries its behavior.
 */
export interface ToolDef {
  name: ToolName;
  run: (ctx: ToolContext, args: Args) => Promise<unknown>;
}

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
 * Build the shared ToolContext from the server context, closing over the
 * warm workspace→enterprise map so every tool benefits from a single cache.
 */
export function createToolContext(context: ServerContext): ToolContext {
  const { client, workspaceEnterpriseMap } = context;

  /**
   * List every workspace across every accessible enterprise, tagged with its
   * enterprise_id. Enterprises are scanned concurrently and each list call is
   * cache-backed. Also warms the workspace→enterprise map as a side effect.
   *
   * Requests every workspace kind (not just the API's STANDARD-only default)
   * so a TEMPLATE/MODULE workspace is still discoverable when a tool needs to
   * resolve a bare workspace_id to its enterprise without a hint.
   */
  async function listAllWorkspaces(): Promise<WorkspaceEntry[]> {
    const enterprises = (await client.listEnterprises()).data as Array<{ id: string }>;
    const perEnterprise = await Promise.all(
      enterprises.map(async (e) => {
        const workspaces = (await client.listWorkspaces(e.id, ["STANDARD", "TEMPLATE", "MODULE"]))
          .data as Array<Omit<WorkspaceEntry, "enterprise_id">>;
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

  const resolveRepoUrl = createRepoResolver({
    listRoots: context.listRoots ?? (async () => []),
    cwd: () => process.cwd(),
    gitRemote: gitRemoteUrl,
  });

  return { client, listAllWorkspaces, getEnterpriseForWorkspace, resolveRepoUrl };
}

/**
 * Register one tool on the server. McpServer.registerTool handles the
 * tools/list and tools/call wiring, generates the JSON Schema from the Zod
 * shape, and validates arguments before the handler runs. We supply the shape,
 * description, and annotations (from validation.ts) and wrap the handler with
 * the shared try/catch + JSON formatting.
 */
export function registerTool(server: McpServer, tool: ToolDef, ctx: ToolContext): void {
  const annotations = TOOL_ANNOTATIONS[tool.name];
  server.registerTool(
    tool.name,
    {
      title: annotations.title,
      description: TOOL_DESCRIPTIONS[tool.name],
      inputSchema: TOOL_SHAPES[tool.name],
      annotations,
    },
    async (args: Args) => {
      try {
        return asText(await tool.run(ctx, args));
      } catch (err) {
        return asError(err);
      }
    }
  );
}
