/**
 * Tool input schemas (as Zod raw shapes) and shared parsing helpers.
 *
 * McpServer.registerTool takes a raw shape, auto-generates the JSON Schema shown
 * to clients, and validates arguments before the handler runs — so these shapes
 * are the single source of truth for both validation and the tools/list output.
 */

import { z } from "zod";

const IAC_TOOLS = [
  "terraform",
  "pulumi",
  "cloudformation",
  "bicep",
  "kubernetes",
  "helm",
  "ansible",
] as const;

const COMPLIANCE_STATUSES = [
  "pass",
  "fail",
  "not_applicable",
  "inconclusive",
  "not_code_verifiable",
] as const;

const idList = (desc: string) => z.array(z.string().min(1)).describe(desc).optional();

// Optional enterprise_id hint, shared by every workspace-scoped tool to skip the
// automatic workspace→enterprise lookup scan.
const enterpriseHint = {
  enterprise_id: z
    .string()
    .min(1)
    .describe("Optional. The workspace's enterprise ID; provide it to skip the automatic lookup.")
    .optional(),
};

export const TOOL_SHAPES = {
  list_enterprises: {},

  list_workspaces: {
    enterprise_id: z.string().min(1).describe("Enterprise ID from list_enterprises."),
  },

  get_workspace_context: {
    workspace_id: z
      .string()
      .min(1)
      .describe("Workspace ID. Provide this or repo_url. Get IDs from list_workspaces.")
      .optional(),
    repo_url: z
      .string()
      .min(1)
      .describe(
        "Git remote URL of the repo (e.g. https://github.com/owner/name or owner/name). Provide this or workspace_id."
      )
      .optional(),
    iac_tool: z
      .enum(IAC_TOOLS)
      .describe("Optional IaC tool to include tool-specific coding guidelines for.")
      .optional(),
    ...enterpriseHint,
  },

  get_ruleset_details: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    ruleset_id: z.string().min(1).describe("Ruleset ID, from get_workspace_context."),
    ...enterpriseHint,
  },

  get_compliance_evaluation: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    ref: z
      .string()
      .min(1)
      .describe("Evaluation id or commit SHA. Omit for the latest evaluation.")
      .optional(),
    ...enterpriseHint,
  },

  list_compliance_findings: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    ref: z.string().min(1).describe("Evaluation id or commit SHA. Optional.").optional(),
    status: z
      .enum(COMPLIANCE_STATUSES)
      .describe("Filter findings by their compliance status.")
      .optional(),
    ...enterpriseHint,
  },

  get_compliance_eval_spec: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    ...enterpriseHint,
  },

  list_enterprise_resources: {
    enterprise_id: z.string().min(1).describe("Enterprise ID."),
  },

  list_modules: {
    enterprise_id: z.string().min(1).describe("Enterprise ID from list_enterprises."),
  },

  list_github_installations: {
    enterprise_id: z.string().min(1).describe("Enterprise ID."),
  },

  list_github_repos: {
    enterprise_id: z.string().min(1).describe("Enterprise ID."),
    installation_id: z
      .string()
      .min(1)
      .describe("GitHub installation ID from list_github_installations."),
    search: z.string().describe("Optional search query to filter repos.").optional(),
  },

  create_workspace: {
    enterprise_id: z.string().min(1).describe("Enterprise ID."),
    name: z.string().min(1).describe("Workspace name."),
    description: z.string().describe("Optional description.").optional(),
    ruleset_ids: idList("Ruleset IDs to attach."),
    mcp_server_ids: idList("MCP server IDs to attach."),
    workflow_ids: idList("Workflow IDs to attach."),
    github_installation_id: z.string().min(1).describe("Optional GitHub installation ID.").optional(),
    github_owner: z.string().min(1).describe("GitHub repo owner (if linking).").optional(),
    github_repo: z.string().min(1).describe("GitHub repo name (if linking).").optional(),
    github_branch: z.string().min(1).describe("GitHub branch (if linking).").optional(),
  },

  link_workspace_to_repo: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    github_installation_id: z
      .string()
      .min(1)
      .describe("GitHub installation ID from list_github_installations."),
    github_owner: z.string().min(1).describe("GitHub repo owner."),
    github_repo: z.string().min(1).describe("GitHub repo name."),
    github_branch: z.string().min(1).describe("Branch to clone (e.g. 'main')."),
    ...enterpriseHint,
  },

  update_workspace_resources: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    add_ruleset_ids: idList("Add rulesets."),
    remove_ruleset_ids: idList("Remove rulesets."),
    add_mcp_server_ids: idList("Add MCP servers."),
    remove_mcp_server_ids: idList("Remove MCP servers."),
    add_workflow_ids: idList("Add workflows."),
    remove_workflow_ids: idList("Remove workflows."),
    ...enterpriseHint,
  },
} as const;

export type ToolName = keyof typeof TOOL_SHAPES;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_enterprises:
    "List enterprises the caller belongs to. Use this to find an enterprise_id for list_workspaces.",
  list_workspaces:
    "List workspaces you have access to in an enterprise. Each workspace includes its linked repo if any. Use this to find workspace IDs.",
  get_workspace_context:
    "Get full workspace context. Returns workspace identity, applicable rulesets, coding guidelines, latest compliance state, and approved module catalog summary. Pass repo_url (from the repo's git remote) or workspace_id. If a repo_url matches no workspace, returns { status: 'unlinked' }.",
  get_ruleset_details:
    "Load the full text of every rule in a single ruleset. Returns rule id, title, full content, required flag, and order.",
  get_compliance_evaluation:
    "Return the summary of a compliance evaluation for this workspace. With no ref, returns the latest evaluation.",
  list_compliance_findings:
    "Return the per-rule findings from a compliance evaluation. With no ref, uses the workspace's latest completed evaluation.",
  get_compliance_eval_spec:
    "Return the system prompt and conventions our CI compliance evaluator uses.",
  list_enterprise_resources:
    "Return the rulesets, MCP servers, and workflows available in an enterprise. Each resource has a required flag.",
  list_modules:
    "Return the enterprise's approved reusable infrastructure modules with source URLs and versions.",
  list_github_installations:
    "Return the GitHub App installations configured for an enterprise. Use when creating a workspace.",
  list_github_repos: "Return repositories accessible via a GitHub App installation.",
  create_workspace:
    "Create a workspace with optional rulesets, MCP servers, and workflows. Call list_enterprise_resources first.",
  link_workspace_to_repo:
    "Link a workspace to a GitHub repo for compliance evaluations on push.",
  update_workspace_resources:
    "Add or remove rulesets, MCP servers, or workflows on a workspace. Required resources cannot be removed.",
};

export interface RepoRef {
  owner: string;
  name: string;
}

/**
 * Parse a git remote URL into a lowercased { owner, name }.
 * Handles https, ssh (git@host:owner/name), and bare "owner/name" forms,
 * with or without a trailing ".git". Returns null if it can't be parsed.
 */
export function parseRepoUrl(url: string): RepoRef | null {
  const cleaned = url
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  if (parts.length < 2) return null;
  const name = parts[parts.length - 1];
  const owner = parts[parts.length - 2];
  if (!owner || !name) return null;
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}
