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
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ApiError, WORKSPACE_PAGE_LIMIT, type InfracodebaseClient } from "../client.js";
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

/**
 * The per-request extras the SDK hands a tool handler: the client's abort
 * signal, the request's `_meta` (a progressToken when the client wants
 * progress), and `sendNotification` for progress updates. Optional, so a tool
 * can be run from a test or from another tool without one.
 */
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The fields we rely on from a workspace as the API sends it (a list row or a single GET). */
export interface ApiWorkspace {
  id: string;
  /** The owning enterprise, as the API reports it. */
  enterprise?: { id?: string } | null;
  /** The API's field for the linked repo. */
  linked_repository?: LinkedRepo | null;
  /** Older shape, kept so a stale server still resolves. */
  repo?: LinkedRepo | null;
}

/** A list row tagged with the enterprise it was listed under. */
export type WorkspaceEntry = ApiWorkspace & { enterprise_id: string };

/** The linked repo of a workspace row, from either field name the API has used. */
function linkedRepoOf(w: ApiWorkspace): LinkedRepo | null {
  return w.linked_repository ?? w.repo ?? null;
}

/**
 * The enterprise id a caller passed does not own the workspace. Raised by
 * `getWorkspaceRepo` once a scan has shown where the workspace really is, so
 * the tool fails with the fix instead of an opaque 404 from its own request.
 */
export class WrongEnterpriseError extends Error {
  constructor(workspaceId: string, given: string, actual: string) {
    super(
      `Workspace ${workspaceId} belongs to enterprise ${actual}, not ${given}. ` +
        `Pass enterprise_id ${actual} or omit it.`
    );
    this.name = "WrongEnterpriseError";
  }
}

/**
 * Everything a tool handler is handed: the API client plus the shared
 * resolution helpers. Built once per server so the helpers share one set of
 * warm maps (workspace→enterprise, workspace→repo).
 */
export interface ToolContext {
  client: InfracodebaseClient;
  /**
   * List every workspace across every accessible enterprise. Scans fresh on
   * each call and refreshes the workspace→enterprise and workspace→repo maps.
   */
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
   * directory. With `options`, only a checkout of `options.repo` counts, and a
   * null repo there trusts no checkout. The result says why when no branch
   * was used.
   */
  resolveBranch(explicit?: string, options?: { repo: LinkedRepo | null }): Promise<BranchDetection>;
  /**
   * The linked repo of a workspace. Null when it has none, or when a complete
   * scan did not list it (a 404 on the direct fetch and then absent from every
   * enterprise). One request when the enterprise is known (a hint or the warm
   * map), else a full scan. Throws when the lookup fails, when the scan was
   * incomplete and did not list the workspace, or (`WrongEnterpriseError`)
   * when the hint names an enterprise the scan shows does not own it.
   * Cached until `forgetWorkspaceRepo` or the next scan.
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
  run: (ctx: ToolContext, args: Args, extra?: ToolExtra) => Promise<unknown>;
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
 * warm workspace→enterprise map (and a workspace→repo map of its own) so
 * every tool shares the same lookups.
 */
export function createToolContext(context: ServerContext): ToolContext {
  const { client, workspaceEnterpriseMap } = context;

  /** Enterprises the last scan could not list, so a "not found" can say so. */
  let skippedEnterprises: Array<{ id: string; error: string }> = [];
  /**
   * Enterprises whose list came back full. The API has no cursor, so a full
   * page may hide workspaces; those are found by a direct fetch instead.
   */
  let truncatedEnterprises: string[] = [];

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
    type Scan = { id: string; workspaces: WorkspaceEntry[] } | { id: string; error: unknown };
    const results: Scan[] = await Promise.all(
      enterprises.map(async (e): Promise<Scan> => {
        // One enterprise that cannot be listed (expired plan, revoked access)
        // must not hide every other enterprise's workspaces.
        try {
          const rows = (
            await client.listWorkspaces(e.id, ["STANDARD", "TEMPLATE", "MODULE"], {
              limit: WORKSPACE_PAGE_LIMIT,
            })
          ).data as ApiWorkspace[];
          return { id: e.id, workspaces: rows.map((w) => ({ ...w, enterprise_id: e.id })) };
        } catch (err) {
          console.error(`[infracodebase-mcp] skipping enterprise ${e.id}: ${messageOf(err)}`);
          return { id: e.id, error: err };
        }
      })
    );
    const failed = results.filter((r) => "error" in r);
    // Every enterprise failing is not "no workspaces". It is the failure
    // itself, in enterprise order so the message is the same on every run,
    // preferring one that carries a sign-in or retry hint.
    if (failed.length > 0 && failed.length === enterprises.length) {
      const hinted = failed.find(
        (f) => f.error instanceof ApiError && (f.error.status === 401 || f.error.status === 429)
      );
      throw (hinted ?? failed[0]).error;
    }
    skippedEnterprises = failed.map((f) => ({ id: f.id, error: messageOf(f.error) }));
    truncatedEnterprises = results
      .filter((r) => "workspaces" in r && r.workspaces.length >= WORKSPACE_PAGE_LIMIT)
      .map((r) => r.id);
    const all: WorkspaceEntry[] = results.flatMap((r) => ("workspaces" in r ? r.workspaces : []));
    for (const w of all) workspaceEnterpriseMap.set(w.id, w.enterprise_id);
    workspaceRepoMap.clear();
    unlistedWorkspaces.clear();
    for (const w of all) workspaceRepoMap.set(w.id, linkedRepoOf(w));
    return all;
  }

  /** Repos of workspaces a scan or a direct fetch has seen. Null is "no repo linked". */
  const workspaceRepoMap = new Map<string, LinkedRepo | null>();
  /** Workspaces a complete scan did not list, so a hintless call does not rescan for them. */
  const unlistedWorkspaces = new Set<string>();

  /**
   * One workspace by id. Undefined when the response is unusable: a 404 (a
   * wrong enterprise, or a server without the endpoint), or a body that names
   * another enterprise than the one asked for, which an older server that
   * does not enforce its path parameter could send. The caller falls back to
   * the scan in both cases.
   */
  async function fetchWorkspace(enterpriseId: string, workspaceId: string) {
    try {
      const w = (await client.getWorkspace(enterpriseId, workspaceId)) as ApiWorkspace;
      return w.enterprise?.id && w.enterprise.id !== enterpriseId ? undefined : w;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return undefined;
      throw err;
    }
  }

  /**
   * Look for a workspace the scan did not list in the enterprises whose list
   * was full, one direct fetch each. A hit warms both maps. Undefined when
   * no truncated enterprise has it.
   */
  async function probeTruncated(workspaceId: string): Promise<WorkspaceEntry | undefined> {
    for (const enterpriseId of truncatedEnterprises) {
      const w = await fetchWorkspace(enterpriseId, workspaceId);
      if (!w) continue;
      workspaceEnterpriseMap.set(workspaceId, enterpriseId);
      workspaceRepoMap.set(workspaceId, linkedRepoOf(w));
      return { ...w, enterprise_id: enterpriseId };
    }
    return undefined;
  }

  async function getWorkspaceRepo(workspaceId: string, enterpriseHint?: string) {
    const knownEnterprise = workspaceEnterpriseMap.get(workspaceId);
    // A repo cached by a prior scan belongs to the enterprise that scan
    // recorded. Do not let that cache bypass validation of a new, conflicting
    // explicit hint; the tool's request would otherwise fail later as an
    // opaque 404.
    if (enterpriseHint && knownEnterprise && knownEnterprise !== enterpriseHint)
      throw new WrongEnterpriseError(workspaceId, enterpriseHint, knownEnterprise);
    const cached = workspaceRepoMap.get(workspaceId);
    if (cached !== undefined) return cached;

    const enterpriseId = enterpriseHint ?? knownEnterprise;
    if (enterpriseId) {
      const w = await fetchWorkspace(enterpriseId, workspaceId);
      if (w) {
        const repo = linkedRepoOf(w);
        workspaceRepoMap.set(workspaceId, repo);
        return repo;
      }
    }
    // A hint is a new lead, so it bypasses a remembered miss above; without
    // one, a complete scan has already answered.
    if (!enterpriseHint && unlistedWorkspaces.has(workspaceId)) return null;

    await listAllWorkspaces();
    if (!workspaceRepoMap.has(workspaceId)) await probeTruncated(workspaceId);
    const found = workspaceRepoMap.get(workspaceId);
    if (found !== undefined) {
      const actual = workspaceEnterpriseMap.get(workspaceId);
      if (enterpriseHint && actual && actual !== enterpriseHint)
        throw new WrongEnterpriseError(workspaceId, enterpriseHint, actual);
      return found;
    }
    if (skippedEnterprises.length > 0) {
      // Not listed, but the scan was not complete: the workspace may be in
      // an enterprise that failed. Say so instead of remembering a miss.
      throw new Error(
        `Workspace ${workspaceId} was not found, and these enterprises could not be listed: ` +
          `${skippedEnterprises.map((e) => `${e.id} (${e.error})`).join("; ")}. ` +
          `Retry, or pass enterprise_id to fetch it directly.`
      );
    }
    // Not listed by a complete scan, and not in any enterprise whose list
    // was full either (the direct fetch there is authoritative): remember
    // that instead of rescanning on every hintless call. forgetWorkspaceRepo
    // or the next scan clears it.
    unlistedWorkspaces.add(workspaceId);
    return null;
  }

  function forgetWorkspaceRepo(workspaceId: string) {
    workspaceRepoMap.delete(workspaceId);
    unlistedWorkspaces.delete(workspaceId);
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
    const probed = await probeTruncated(workspaceId);
    if (probed) return probed.enterprise_id;

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

/** A copy of `row` without `fields`, for the summary detail level. Non-objects pass through. */
export function omitFields(row: unknown, fields: readonly string[]): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const copy = { ...(row as Record<string, unknown>) };
  for (const field of fields) delete copy[field];
  return copy;
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
    async (args: Args, extra: ToolExtra) => {
      try {
        return asText(await tool.run(ctx, args, extra));
      } catch (err) {
        return asError(err);
      }
    }
  );
}
