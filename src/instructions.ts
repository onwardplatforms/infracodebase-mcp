/** Shared across initialization, tool descriptions, and catalog responses. */
export const MODULE_SELECTION_GUIDANCE =
  "Recommend a module only when it clearly fits the user's intent. If considering multiple modules, present them as options with their tradeoffs and let the user choose. Always explicitly ask whether the user wants to use the recommended module(s), and wait for their answer before using them. Choosing an enterprise or describing an app is not module approval. Discovery needs no approval.";

export const SERVER_INSTRUCTIONS_BUDGET = 1800;
export const SERVER_INSTRUCTIONS = `Before designing or changing infrastructure, call get_context; omit arguments to detect Git. Empty folders work. If selection_required, choose relevant optional rules and call get_rules with enterprise_id and ruleset_ids (or []). Retain setup for later. Existing workspace rules stay authoritative. Resolve selection_required with get_rules; other access/catalog errors block generation.

${MODULE_SELECTION_GUIDANCE}

After agreement, fetch versions with list_modules(module_id) and inspect the chosen interface through Terraform or authenticated VCS. Never invent inputs or versions. If inspection fails, ask before substituting raw resources. Prefer registry_source with version, otherwise source_url with Git ref. If no module fits, draft from scratch under the returned rules and guidelines. Clarify architecture; do not assume a load balancer.

Draft without requiring a repo or workspace. Once a remote and pushed branch exist in an authorized publish/compliance flow, call setup_workspace with the saved selection. Don't create a remote, push, or deploy without authorization. Preserve IDs on partial failure; never blindly recreate workspaces. Recheck code against current rules.

Compliance evaluates pushed code. Check once for a run covering the commit; if none, trigger with the branch ref, including pushes before webhook setup. Share its URL without polling. Surface setup failures; drafting is not passing compliance.`;
