/**
 * Tool input schemas (as Zod raw shapes) and shared parsing helpers.
 *
 * McpServer.registerTool takes a raw shape, auto-generates the JSON Schema shown
 * to clients, and validates arguments before the handler runs - so these shapes
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
    branch: z
      .string()
      .min(1)
      .describe(
        "Scope 'latest' to this branch (ignored if ref is given). Falls back to the " +
          "workspace's default branch, then to the most recent completed evaluation on any branch. " +
          "Reflects the last evaluation of a PUSHED commit on this branch — it will not show local, " +
          "uncommitted, or unpushed changes."
      )
      .optional(),
    ...enterpriseHint,
  },

  trigger_compliance_evaluation: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    ref: z
      .string()
      .min(1)
      .describe("Optional commit SHA or branch to evaluate. Defaults to the current HEAD.")
      .optional(),
    ruleset_id: z
      .string()
      .min(1)
      .describe("Scope the run to a single ruleset. Omit for a full evaluation.")
      .optional(),
    rule_id: z
      .string()
      .min(1)
      .describe("Scope the run to a single rule. Mutually exclusive with rule_ids.")
      .optional(),
    rule_ids: idList(
      "Scope the run to a batch of specific rules, e.g. the rules just fixed. " +
        "Mutually exclusive with rule_id."
    ),
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
    "Load the full text of every rule in a single ruleset. Returns rule id, title, full content, required flag, enabled flag, and order. Includes disabled rules (enabled: false) so you can see the whole catalog, not just what's currently active — filter on `enabled` if you only want the rules actually being evaluated.",
  get_compliance_evaluation:
    "Return the summary of a compliance evaluation for this workspace. With no ref, returns the latest evaluation, scoped to branch if given. The response includes a `url` to the evaluation's results page — share it with the user rather than just reporting the score inline.",
  trigger_compliance_evaluation:
    "Trigger a compliance evaluation. IMPORTANT: this evaluates the code already pushed to the linked GitHub branch, not your local working tree — the platform has no visibility into uncommitted or unpushed local changes. Commit and push everything to the remote branch you're evaluating BEFORE calling this tool, or the run will silently score stale, previously-pushed code instead of what you just wrote. Run at most one full evaluation per task — after that, always scope with ruleset_id, rule_id, or rule_ids to re-check just the rules you fixed, not the whole workspace. This call returns immediately with the queued/running evaluation — the evaluation itself is a long-running background operation, the same as a CI check on a pull request, and can take several minutes depending on rule count. Do not wait on it inline or poll get_compliance_evaluation in a tight loop; treat it like a background CI run — continue with other requested work and check back on it later. The response includes a `url` to the evaluation's results page — share it with the user so they can watch it progress and see the full results once it completes.",
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
