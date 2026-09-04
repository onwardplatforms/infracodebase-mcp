/**
 * Tool input schemas (as Zod raw shapes), descriptions, and annotations.
 *
 * McpServer.registerTool takes a raw shape, auto-generates the JSON Schema shown
 * to clients, and validates arguments before the handler runs - so these shapes
 * are the single source of truth for both validation and the tools/list output.
 *
 * Descriptions are budgeted (see DESCRIPTION_BUDGET): clients truncate what the
 * model sees, so anything the agent must act on belongs in the tool's response
 * (`message`, `next`, `decisions_needed`), not at the end of a long description.
 */

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * Mirrors the API's `iac_tool` enum exactly. Helm is deliberately absent: the
 * API rejects it (HTTP 400), and Helm charts fall under the kubernetes
 * guidelines.
 */
const IAC_TOOLS = ["terraform", "pulumi", "cloudformation", "bicep", "kubernetes", "ansible"] as const;

const COMPLIANCE_STATUSES = [
  "pass",
  "fail",
  "not_applicable",
  "inconclusive",
  "not_code_verifiable",
] as const;

const WORKSPACE_KINDS = ["STANDARD", "TEMPLATE", "MODULE"] as const;

/**
 * Longest description a client is known to show in full. Claude Code cuts tool
 * descriptions at 2,048 characters; the old trigger_compliance_evaluation text
 * was 2,996 and lost its whole "share the url, do not poll" block.
 */
export const DESCRIPTION_BUDGET = 1900;

const idList = (desc: string) => z.array(z.string().min(1)).describe(desc).optional();

const iacTool = z
  .enum(IAC_TOOLS)
  .describe("Optional IaC tool to include tool-specific coding guidelines for.")
  .optional();

// Optional enterprise_id hint, shared by every workspace-scoped tool to skip the
// automatic workspace→enterprise lookup scan.
const enterpriseHint = {
  enterprise_id: z
    .string()
    .min(1)
    .describe("Optional. The workspace's enterprise ID; provide it to skip the automatic lookup.")
    .optional(),
};

const repoPath = (suffix: string) =>
  z
    .string()
    .min(1)
    .describe(
      `Full provider path of the repo${suffix}, exactly as returned by list_vcs_repos ` +
        "(GitLab subgroups included, e.g. 'group/sub/project')."
    );

const branchToLink = z
  .string()
  .min(1)
  .describe(
    "Branch to link, e.g. 'main'. Must already exist on the remote — a freshly " +
      "created, empty repo has no branches, so seed an initial commit and push it first " +
      "or the link fails."
  );

export const TOOL_SHAPES = {
  list_enterprises: {},

  list_workspaces: {
    enterprise_id: z.string().min(1).describe("Enterprise ID from list_enterprises."),
    kinds: z
      .array(z.enum(WORKSPACE_KINDS))
      .describe(
        "Workspace kinds to include. Defaults to STANDARD only if omitted — template and " +
          "module workspaces are excluded unless explicitly requested here. Pass all three " +
          "to see the full set, e.g. when reconciling against an enterprise's workspace_count " +
          "(which counts STANDARD workspaces only, same default as this tool)."
      )
      .optional(),
  },

  get_workspace_context: {
    workspace_id: z
      .string()
      .min(1)
      .describe("Workspace ID, if already known (from list_workspaces or a setup result).")
      .optional(),
    repo_url: z
      .string()
      .min(1)
      .describe(
        "Git remote URL of the repo (e.g. https://github.com/owner/name or owner/name). " +
          "Omit both this and workspace_id to auto-detect the repo from the client's workspace " +
          "root or the server's working directory."
      )
      .optional(),
    iac_tool: iacTool,
  },

  get_ruleset_details: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    ruleset_id: z.string().min(1).describe("Ruleset ID, from get_workspace_context."),
    ...enterpriseHint,
  },

  list_workspace_rulesets: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
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
      .describe(
        "The branch name you just pushed (e.g. 'main'). Resolves that branch's current remote " +
          "commit and records the branch on the run. Do not omit it (that evaluates the " +
          "workspace's interactive checkout, which can lag a fresh push) and do not pass a bare " +
          "commit SHA (it records no branch, shown as 'branch unknown' in the product)."
      )
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

  list_vcs_connections: {
    enterprise_id: z.string().min(1).describe("Enterprise ID."),
    provider: z
      .string()
      .min(1)
      .describe("Optional provider key to filter by (e.g. 'github', 'gitlab').")
      .optional(),
  },

  list_vcs_repos: {
    enterprise_id: z.string().min(1).describe("Enterprise ID."),
    connection_id: z.string().min(1).describe("Connection ID from list_vcs_connections."),
    search: z.string().describe("Optional search query to filter repos by name.").optional(),
  },

  plan_workspace_setup: {
    repo_url: z
      .string()
      .min(1)
      .describe(
        "Git remote URL or owner/name of the repo to set up. Omit to auto-detect it from the " +
          "client's workspace root or the server's working directory."
      )
      .optional(),
    enterprise_id: z
      .string()
      .min(1)
      .describe("Optional. Only consider this enterprise (use after a needs_decision result).")
      .optional(),
    connection_id: z
      .string()
      .min(1)
      .describe(
        "Optional. Only consider this version-control connection (use after a needs_decision result)."
      )
      .optional(),
  },

  setup_workspace: {
    enterprise_id: z.string().min(1).describe("Enterprise ID from the plan."),
    connection_id: z.string().min(1).describe("Version-control connection ID from the plan."),
    repo_path: repoPath(" from the plan (repo.path)"),
    branch: z
      .string()
      .min(1)
      .describe(
        "Branch to link: the plan's repo.default_branch unless the user chose another. " +
          "Must already exist on the remote."
      ),
    workspace_name: z
      .string()
      .min(1)
      .describe("Name for the new workspace. Required unless existing_workspace_id is given.")
      .optional(),
    description: z.string().describe("Optional description for a new workspace.").optional(),
    ruleset_ids: idList(
      "Ruleset IDs to attach: the plan's required ids plus any optional ones the user chose."
    ),
    existing_workspace_id: z
      .string()
      .min(1)
      .describe(
        "Link the repo to this existing unlinked workspace (from the plan's " +
          "existing_unlinked_workspaces) instead of creating a new one."
      )
      .optional(),
    iac_tool: iacTool,
  },

  create_workspace: {
    enterprise_id: z.string().min(1).describe("Enterprise ID."),
    name: z.string().min(1).describe("Workspace name."),
    description: z.string().describe("Optional description.").optional(),
    ruleset_ids: idList("Ruleset IDs to attach."),
    mcp_server_ids: idList("MCP server IDs to attach."),
    workflow_ids: idList("Workflow IDs to attach."),
    connection_id: z
      .string()
      .min(1)
      .describe("Version-control connection ID from list_vcs_connections (if linking a repo).")
      .optional(),
    repo_path: repoPath(" to link").optional(),
    branch: branchToLink.optional(),
  },

  link_workspace_to_repo: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    connection_id: z
      .string()
      .min(1)
      .describe("Version-control connection ID from list_vcs_connections."),
    repo_path: repoPath(""),
    branch: branchToLink,
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
    "List enterprises the caller belongs to. Use this to find an enterprise_id for list_workspaces. Each row's workspace_count only counts STANDARD-kind workspaces — pass kinds: ['STANDARD','TEMPLATE','MODULE'] on list_workspaces if that number doesn't match what you see there.",
  list_workspaces:
    "List workspaces you have access to in an enterprise. Each workspace includes its linked repo if any. Use this to find workspace IDs. Defaults to STANDARD-kind workspaces only — pass kinds to include template and/or module workspaces too.",
  get_workspace_context:
    "Start here before writing or changing any IaC. Returns workspace identity, applicable rulesets, coding guidelines, latest compliance state, and a module catalog summary. Call it with no arguments to auto-detect the repo from the client's workspace root or the server's working directory (the result then carries resolved_repo_url and resolved_from), or pass repo_url (the git remote) or workspace_id. `status` is one of: linked (context returned), unlinked (no workspace governs this repo, so no rules are in force: do not write IaC yet; follow `message`, then call plan_workspace_setup), no_access (a workspace exists but you cannot see it; do not imply it is missing), or ambiguous (the repo matches workspaces in several enterprises; pick from `candidates` and call again with workspace_id). Every non-linked status includes a `message` saying what to do next.",
  get_ruleset_details:
    "Load the full text of every rule in a single ruleset. Returns rule id, title, full content, required flag, enabled flag, and order. Includes disabled rules (enabled: false) so you can see the whole catalog, not just what's currently active — filter on `enabled` if you only want the rules actually being evaluated.",
  list_workspace_rulesets:
    "List every ruleset relevant to a workspace — including enterprise rulesets that exist in the catalog but this workspace hasn't opted into. Each row has `effective_enabled` (is it actually active here) and `workspace_setting` (the workspace's stored opinion, null if it's never opted in/out). Use this when you notice code introducing a resource type or concern that isn't covered by any currently-active ruleset, to check whether a relevant one already exists but just isn't attached — then offer to attach it via update_workspace_resources rather than assuming none exists. Only enterprise rulesets that are enabled and not required can be attached this way; required ones are already active regardless.",
  get_compliance_evaluation:
    "Return the summary of a compliance evaluation for this workspace. With no ref, returns the latest evaluation, scoped to branch if given. Call it once to check the current state; a still-running evaluation comes back with a `next` field, and you should never call this in a loop to wait for it. The response includes a `url` to the results page — share it with the user rather than only reporting the score inline.",
  trigger_compliance_evaluation:
    "Start a compliance evaluation of the code already pushed to the linked branch. The platform never sees your local tree: commit and push first, or the run scores stale code while the result looks valid. Pass ref as the branch name you pushed (e.g. 'main'); never omit it (that evaluates a possibly stale checkout) and never pass a bare SHA (it records no branch). Often no manual full run is needed: with CI compliance enabled, a push to the default branch or to a branch with an open pull request auto-runs a full evaluation. After pushing, call get_compliance_evaluation once; if a run for your commit already exists, trigger only a scoped re-check (rule_ids, rule_id, or ruleset_id) for the rules you fixed. Trigger a full run yourself only when no auto-run applies, at most once per task. If the server folds your scoped request into an already-running full run, the response has deduped: true with requested_scope and effective_scope; that is not an error. The call returns immediately with the queued run, a results `url`, and a `next` field telling you what to do: share the url with the user and stop. Never poll, sleep, or estimate how long it will take.",
  list_compliance_findings:
    "Return the per-rule findings from a compliance evaluation. With no ref, uses the workspace's latest completed evaluation.",
  get_compliance_eval_spec:
    "Return the system prompt and conventions our CI compliance evaluator uses.",
  list_enterprise_resources:
    "Return the rulesets, MCP servers, and workflows available in an enterprise. Each resource has a required flag.",
  list_modules:
    "Return the enterprise's approved reusable infrastructure modules with source URLs and versions.",
  list_vcs_connections:
    "Return the version-control connections (GitHub, GitLab, …) configured for an enterprise, each with its provider, host, and account. Use a connection's id with list_vcs_repos and when linking a repo.",
  list_vcs_repos:
    "Return repositories accessible via a version-control connection — same shape for every provider. Each repo's `path` is the full provider path (GitLab subgroups included); pass it verbatim as repo_path when linking.",
  plan_workspace_setup:
    "Read-only. Works out everything needed to bring an unlinked repo under governance in one call: resolves the repo (auto-detected when repo_url is omitted), finds the enterprise and version-control connection that can see it, checks for a workspace that already owns it, lists unlinked workspaces the repo could join, and lists the enterprise's rulesets with the required ones pre-selected. Makes no changes. `status` is ready (a `proposed` plan plus `decisions_needed`), needs_decision (several enterprises or connections can see the repo: ask the user, then call again with enterprise_id and connection_id), repo_not_found (no connection can see the repo: it may not exist yet, or the connection lacks access), or already_linked. Show the user the plan and get their answer to each decision before calling setup_workspace.",
  setup_workspace:
    "Apply a plan from plan_workspace_setup after the user has confirmed it. Either creates a workspace (workspace_name + ruleset_ids) linked to the repo, or links the repo to an existing unlinked workspace (existing_workspace_id) and attaches ruleset_ids to it, then reloads the workspace context so you can write against the rules immediately. Check the result: repository_linked false means the workspace exists but the link failed (see repository_error); a `warning` means the link succeeded but the delivery webhook did not register, so pushes will NOT trigger compliance until the repo is re-linked. Relay both to the user; never report an unqualified success over them. Do not call this until the user has confirmed the plan.",
  create_workspace:
    "Create a workspace with optional rulesets, MCP servers, and workflows. For a repo that came back unlinked, prefer plan_workspace_setup + setup_workspace, which do the lookups below for you. Call list_enterprise_resources first. To also link a repo, pass connection_id + repo_path + branch (from list_vcs_connections / list_vcs_repos). A repo links to at most one workspace, so first confirm with list_workspaces that no workspace already owns this repo — if one does, attach rulesets to it with update_workspace_resources instead of creating a second workspace, since the link here would fail. This tool links an existing repo; it does not create one on the provider — the repo must already exist there (create it with the provider's CLI, e.g. gh or glab, if it doesn't). IMPORTANT: check `repository_linked` in the result whenever you request a link — false means the workspace exists but the link failed (see repository_error). A `warning` means the repo linked but its delivery webhook couldn't be registered, so pushes will NOT trigger compliance until it's re-linked — surface both to the user, never report an unqualified success over them.",
  link_workspace_to_repo:
    "Link a workspace to a repo (any provider) for compliance evaluations on push. IMPORTANT: a `warning` in the result means the repo linked but its delivery webhook couldn't be registered, so pushes will NOT trigger compliance until it's re-linked — surface it to the user, never report an unqualified success over it.",
  update_workspace_resources:
    "Add or remove rulesets, MCP servers, or workflows on a workspace. Required resources cannot be removed. Attaching a ruleset requires the caller's workspace.rulesets.manage permission — a caller without it gets a clean permission error, so it's safe to attempt. When you're the one suggesting a ruleset be attached (e.g. via list_workspace_rulesets), offer it to the user and let them confirm before calling this — don't attach it unprompted.",
};

/**
 * MCP tool annotations. Clients use them to badge read-only tools, to skip
 * permission prompts for them, and to warn before destructive ones; they cost
 * nothing where unsupported. `openWorldHint` is false throughout: every tool
 * talks to one known API, not the open internet.
 */
const readOnly = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const writes = (
  title: string,
  opts: { destructive: boolean; idempotent: boolean }
): ToolAnnotations => ({
  title,
  readOnlyHint: false,
  destructiveHint: opts.destructive,
  idempotentHint: opts.idempotent,
  openWorldHint: false,
});

export const TOOL_ANNOTATIONS: Record<ToolName, ToolAnnotations> = {
  list_enterprises: readOnly("List enterprises"),
  list_workspaces: readOnly("List workspaces"),
  get_workspace_context: readOnly("Get workspace context"),
  get_ruleset_details: readOnly("Get ruleset details"),
  list_workspace_rulesets: readOnly("List workspace rulesets"),
  get_compliance_evaluation: readOnly("Get compliance evaluation"),
  list_compliance_findings: readOnly("List compliance findings"),
  get_compliance_eval_spec: readOnly("Get compliance evaluator spec"),
  list_enterprise_resources: readOnly("List enterprise resources"),
  list_modules: readOnly("List approved modules"),
  list_vcs_connections: readOnly("List version-control connections"),
  list_vcs_repos: readOnly("List repositories"),
  plan_workspace_setup: readOnly("Plan workspace setup"),
  // Creates records but never removes or replaces any.
  trigger_compliance_evaluation: writes("Trigger compliance evaluation", {
    destructive: false,
    idempotent: false,
  }),
  create_workspace: writes("Create workspace", { destructive: false, idempotent: false }),
  setup_workspace: writes("Set up workspace", { destructive: false, idempotent: false }),
  // Replaces an existing repo link.
  link_workspace_to_repo: writes("Link workspace to repository", {
    destructive: true,
    idempotent: true,
  }),
  // Can detach resources.
  update_workspace_resources: writes("Update workspace resources", {
    destructive: true,
    idempotent: true,
  }),
};
