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

const WORKSPACE_KINDS = ["STANDARD", "TEMPLATE", "MODULE"] as const;

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
        "Commit SHA, branch, or tag to evaluate — must already be pushed to the remote. " +
          "Pass the branch name you pushed (e.g. 'main'): that resolves the branch's current " +
          "remote commit AND records the branch on the run. Do NOT omit this — omitting " +
          "evaluates the workspace's current interactive checkout (uncommitted changes committed " +
          "first), which can lag a fresh push, so the run may score stale code. Do NOT pin a bare " +
          "commit SHA either — it evaluates the right commit but records no branch, which the " +
          "product shows as 'branch unknown'. For a precise re-run, keep ref on the branch name " +
          "and narrow with rule_ids / ruleset_id."
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
    search: z.string().describe("Optional search query to filter repos.").optional(),
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
    repo_path: z
      .string()
      .min(1)
      .describe(
        "Full provider path of the repo to link, exactly as returned by list_vcs_repos " +
          "(GitLab subgroups included, e.g. 'group/sub/project')."
      )
      .optional(),
    branch: z
      .string()
      .min(1)
      .describe(
        "Branch to link, e.g. 'main'. Must already exist on the remote — a freshly " +
          "created, empty repo has no branches, so seed an initial commit and push it first " +
          "or the link fails."
      )
      .optional(),
  },

  link_workspace_to_repo: {
    workspace_id: z.string().min(1).describe("Workspace ID."),
    connection_id: z
      .string()
      .min(1)
      .describe("Version-control connection ID from list_vcs_connections."),
    repo_path: z
      .string()
      .min(1)
      .describe(
        "Full provider path of the repo, exactly as returned by list_vcs_repos " +
          "(GitLab subgroups included, e.g. 'group/sub/project')."
      ),
    branch: z
      .string()
      .min(1)
      .describe(
        "Branch to link, e.g. 'main'. Must already exist on the remote — a freshly " +
          "created, empty repo has no branches, so seed an initial commit and push it first " +
          "or the link fails."
      ),
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
    "Get full workspace context. Returns workspace identity, applicable rulesets, coding guidelines, latest compliance state, and approved module catalog summary. Pass repo_url (from the repo's git remote) or workspace_id. Response `status` is one of: linked (context returned as above), unlinked (no workspace matches this repo, so no rulesets are in force yet — run the full setup before writing any IaC: pick the enterprise and VCS connection, confirm the repo exists on the provider, then create_workspace with the right rulesets attached, and only then write code, so the rules are in hand up front instead of forcing rework; don't write IaC into an unlinked repo and link afterward), no_access (a workspace exists but you don't have permission to see it — don't imply it doesn't exist), or ambiguous (the repo matches workspaces in more than one enterprise — call again with an explicit workspace_id). Every non-linked status includes a message field with what to tell the user or do next.",
  get_ruleset_details:
    "Load the full text of every rule in a single ruleset. Returns rule id, title, full content, required flag, enabled flag, and order. Includes disabled rules (enabled: false) so you can see the whole catalog, not just what's currently active — filter on `enabled` if you only want the rules actually being evaluated.",
  list_workspace_rulesets:
    "List every ruleset relevant to a workspace — including enterprise rulesets that exist in the catalog but this workspace hasn't opted into. Each row has `effective_enabled` (is it actually active here) and `workspace_setting` (the workspace's stored opinion, null if it's never opted in/out). Use this when you notice code introducing a resource type or concern that isn't covered by any currently-active ruleset, to check whether a relevant one already exists but just isn't attached — then offer to attach it via update_workspace_resources rather than assuming none exists. Only enterprise rulesets that are enabled and not required can be attached this way; required ones are already active regardless.",
  get_compliance_evaluation:
    "Return the summary of a compliance evaluation for this workspace. With no ref, returns the latest evaluation, scoped to branch if given. Call this once to check the current state — do not call it repeatedly in a loop to wait for a running evaluation to finish; point the user at the `url` to watch progress instead. The response includes a `url` to the evaluation's results page — share it with the user rather than just reporting the score inline.",
  trigger_compliance_evaluation:
    "Trigger a compliance evaluation. IMPORTANT: this evaluates the code already pushed to the linked branch, not your local working tree — the platform has no visibility into uncommitted or unpushed local changes. Commit and push everything to the remote branch you're evaluating BEFORE calling this tool, or the run will silently score stale, previously-pushed code instead of what you just wrote. Prefer scoped runs, and often you need no manual full run at all: a push auto-runs a FULL evaluation (all rules) whenever CI compliance is enabled and you pushed to the default branch OR to a branch that has an open pull/merge request — the same CI check a PR shows. So after pushing, check once with get_compliance_evaluation whether a run already started for your commit; if one did, let it be the full run and use a scoped trigger (ruleset_id, rule_id, or rule_ids) only to re-verify the specific rules you fixed. Trigger a full evaluation yourself only when no auto-run applies (a non-default branch with no open PR, or CI compliance turned off) — at most one full run per task. When you do trigger, pass ref as the branch name you pushed (e.g. 'main') — not omitted and not a bare SHA. The branch name resolves the branch's current remote commit and records the branch label; omitting ref evaluates the workspace's current interactive checkout, which can lag a fresh push, and a SHA-scoped run records no branch and shows up as 'branch unknown' in the product. Note: if a push already kicked off a full webhook evaluation for the same commit, your scoped trigger may be adopted into that already-running full run rather than starting a new one. When that happens the response carries `deduped: true`, plus `requested_scope` (what you asked for) and `effective_scope` (what actually ran, e.g. 'full') — a fresh run omits all three. That is not an error: a full run already covers your scoped rules, so check the returned evaluation once (or when the user asks) rather than re-triggering, and tell the user the full run is standing in for the scoped one. This call returns immediately with the queued/running evaluation — the evaluation itself is a long-running background operation, the same as a CI check on a pull request. Once it returns, share the `url` with the user and STOP: the run completes on its own. Do NOT sleep, run wait-loops, or call get_compliance_evaluation over and over to watch it finish — that does not background the work, it just blocks the session. Do any other work the user asked for; otherwise end your turn. Check the result at most once later, or when the user asks — never on a timer and never in a loop. Do NOT report an elapsed time or an ETA: you have no reliable clock for these runs and they are not on a predictable schedule, so any time figure you give will be wrong. If the user asks how it is going, call get_compliance_evaluation once and report only the status and the pass/fail/na counts from the response, then point them at the `url` to watch the rest.",
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
  create_workspace:
    "Create a workspace with optional rulesets, MCP servers, and workflows. Call list_enterprise_resources first. To also link a repo, pass connection_id + repo_path + branch (from list_vcs_connections / list_vcs_repos). A repo links to at most one workspace, so first confirm with list_workspaces that no workspace already owns this repo — if one does, attach rulesets to it with update_workspace_resources instead of creating a second workspace, since the link here would fail. This tool links an existing repo; it does not create one on the provider — the repo must already exist there (create it with the provider's CLI, e.g. gh or glab, if it doesn't). IMPORTANT: check `repository_linked` in the result whenever you request a link — false means the workspace exists but the link failed (see repository_error). A `warning` means the repo linked but its delivery webhook couldn't be registered, so pushes will NOT trigger compliance until it's re-linked — surface both to the user, never report an unqualified success over them.",
  link_workspace_to_repo:
    "Link a workspace to a repo (any provider) for compliance evaluations on push. IMPORTANT: a `warning` in the result means the repo linked but its delivery webhook couldn't be registered, so pushes will NOT trigger compliance until it's re-linked — surface it to the user, never report an unqualified success over it.",
  update_workspace_resources:
    "Add or remove rulesets, MCP servers, or workflows on a workspace. Required resources cannot be removed. Attaching a ruleset requires the caller's workspace.rulesets.manage permission — a caller without it gets a clean permission error, so it's safe to attempt. When you're the one suggesting a ruleset be attached (e.g. via list_workspace_rulesets), offer it to the user and let them confirm before calling this — don't attach it unprompted.",
};
