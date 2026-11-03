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
import { ApiError, type InfracodebaseClient } from "../client.js";
import type { ServerContext } from "../server.js";
import {
  createBranchResolver,
  createRepoResolver,
  gitBranchName,
  gitRemoteUrl,
  type BranchDetection,
  type LinkedRepo,
  type ResolvedRepo,
} from "../repo-detect.js";
import { TOOL_SHAPES, TOOL_DESCRIPTIONS, TOOL_ANNOTATIONS, type ToolName } from "./validation.js";

export type Args = Record<string, any>;

/** Minimal shape we rely on from a workspace list entry. */
export interface WorkspaceEntry {
  id: string;
  enterprise_id: string;
  /** The API's field for the linked repo. */
  linked_repository?: LinkedRepo | null;
  /** Older shape, kept so a stale server still resolves. */
  repo?: LinkedRepo | null;
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
  /**
   * The branch to read compliance state for: an explicit argument, else the
   * checked-out branch of the client's workspace root or the server's working
   * directory. Null when no branch can be detected.
   */
  resolveBranch(explicit?: string, options?: { repo?: LinkedRepo | null }): Promise<BranchDetection>;
  /**
   * The linked repo of a workspace, or null when it has none or it cannot be
   * read. One request when the enterprise is known (a hint or the warm map),
   * else a full scan. Cached until `forgetWorkspaceRepo`.
   */
  getWorkspaceRepo(workspaceId: string, enterpriseHint?: string): Promise<LinkedRepo | null>;
  /** Drop what is cached about a workspace's repo after a tool changes its link. */
  forgetWorkspaceRepo(workspaceId: string): void;
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

  /** Enterprises the last scan could not list, so a "not found" can say so. */
  let skippedEnterprises: Array<{ id: string; error: string }> = [];

  /**
   * List every workspace across every accessible enterprise, tagged with its
   * enterprise_id. Enterprises are scanned concurrently. Also warms the
   * workspace→enterprise and workspace→repo maps as a side effect.
   *
   * Requests every workspace kind (not just the API's STANDARD-only default)
   * so a TEMPLATE/MODULE workspace is still discoverable when a tool needs to
   * resolve a bare workspace_id to its enterprise without a hint.
   */
  async function listAllWorkspaces(): Promise<WorkspaceEntry[]> {
    const enterprises = (await client.listEnterprises()).data as Array<{ id: string }>;
    const skipped: Array<{ id: string; error: unknown }> = [];
    const perEnterprise = await Promise.all(
      enterprises.map(async (e) => {
        // One enterprise that cannot be listed (expired plan, revoked access)
        // must not hide every other enterprise's workspaces.
        try {
          const workspaces = (await client.listWorkspaces(e.id, ["STANDARD", "TEMPLATE", "MODULE"]))
            .data as Array<Omit<WorkspaceEntry, "enterprise_id">>;
          return workspaces.map((w) => ({ ...w, enterprise_id: e.id }));
        } catch (err) {
          console.error(`[infracodebase-mcp] skipping enterprise ${e.id}: ${messageOf(err)}`);
          skipped.push({ id: e.id, error: err });
          return [];
        }
      })
    );
    // Every enterprise failing is not "no workspaces". It is the failure
    // itself (a rate limit, an outage), which carries its own hint.
    if (skipped.length > 0 && skipped.length === enterprises.length) throw skipped[0].error;
    skippedEnterprises = skipped.map(({ id, error }) => ({ id, error: messageOf(error) }));
    const all = perEnterprise.flat();
    for (const w of all) workspaceEnterpriseMap.set(w.id, w.enterprise_id);
    workspaceRepoMap.clear();
    for (const w of all) workspaceRepoMap.set(w.id, w.linked_repository ?? w.repo ?? null);
    return all;
  }

  const workspaceRepoMap = new Map<string, LinkedRepo | null>();

  async function getWorkspaceRepo(workspaceId: string, enterpriseHint?: string) {
    if (workspaceRepoMap.has(workspaceId)) return workspaceRepoMap.get(workspaceId) ?? null;

    const enterpriseId = enterpriseHint ?? workspaceEnterpriseMap.get(workspaceId);
    if (enterpriseId) {
      try {
        const w = (await client.getWorkspace(enterpriseId, workspaceId)) as Omit<
          WorkspaceEntry,
          "enterprise_id"
        >;
        const repo = w.linked_repository ?? w.repo ?? null;
        workspaceRepoMap.set(workspaceId, repo);
        return repo;
      } catch (err) {
        // A wrong hint (or a server without this endpoint) falls back to the
        // scan; the tool's own request then fails with the real message.
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
    }

    await listAllWorkspaces();
    // Not listed (past the page limit, or gone): remember that instead of
    // rescanning on every call. forgetWorkspaceRepo clears it.
    if (!workspaceRepoMap.has(workspaceId)) workspaceRepoMap.set(workspaceId, null);
    return workspaceRepoMap.get(workspaceId) ?? null;
  }

  function forgetWorkspaceRepo(workspaceId: string) {
    workspaceRepoMap.delete(workspaceId);
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

    const unlisted = skippedEnterprises.length
      ? ` It may be in an enterprise that could not be listed: ${skippedEnterprises
          .map((e) => `${e.id} (${e.error})`)
          .join("; ")}.`
      : "";
    throw new Error(
      `Workspace ${workspaceId} not found in any accessible enterprise.${unlisted} ` +
        `Use list_workspaces to find valid workspace IDs.`
    );
  }

  const detection = {
    listRoots: context.listRoots ?? (async () => []),
    cwd: () => process.cwd(),
    gitRemote: gitRemoteUrl,
    gitBranch: gitBranchName,
  };
  const resolveRepoUrl = createRepoResolver(detection);
  const resolveBranch = createBranchResolver(detection);

  return {
    client,
    listAllWorkspaces,
    getEnterpriseForWorkspace,
    resolveRepoUrl,
    resolveBranch,
    getWorkspaceRepo,
    forgetWorkspaceRepo,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
