/**
 * Server instructions handed to every MCP client at initialize.
 *
 * Keep this SHORT. Clients cap what the model actually sees: Claude Code
 * displayed roughly the first 1,850 characters of the previous 9,850-character
 * version, cutting it off inside step 2 of a 7-step recipe, so most of the
 * protocol never reached the agent. Behavioural guidance now lives in tool
 * responses (`message`, `next`, `decisions_needed`), which are never truncated
 * and can change without a client upgrade. `instructions.test.ts` enforces the
 * budget below.
 */
export const SERVER_INSTRUCTIONS_BUDGET = 1800;

export const SERVER_INSTRUCTIONS = `Before writing or changing any infrastructure-as-code (Terraform, Pulumi, CloudFormation, Bicep, Kubernetes, Helm, Ansible), even in an empty repo, call get_workspace_context first, on every IaC turn. It says whether infracodebase governs this repo and which rulesets and coding guidelines apply. Compliance gates are mandatory, not advisory: deliver the change and prove it complies, rather than finishing quickly.

Read the returned status:
- linked: write against the rulesets and guidelines. They are scoped to the detected branch: on a feature branch they come from its latest completed check, and \`coverage.rulesets_source: workspace_settings\` under automatic discovery means a full check evaluates more rulesets than listed, so never call it complete.
- unlinked: no rules are in force yet. Do not write IaC. Call plan_workspace_setup (read-only), ask the user the question in \`message\` with the plan's options, call setup_workspace only after they answer, then reload the context.
- no_access or ambiguous: follow \`message\`.

Evaluations run against pushed code, never your local tree. Commit and push first, pass \`ref\` as the branch name, and prefer scoped runs: a push to the default branch or a branch with an open pull request already runs a full evaluation. Trigger results carry a \`url\` and a \`next\` field: share the url and stop; never poll, sleep, or estimate run time.

For failures the code can't or shouldn't fix, offer exceptions: show the user each rule's type and justification and call submit_compliance_exceptions only after they agree. It requests review by default; grant only when the user explicitly says grant.

Always relay a \`warning\` or \`repository_error\` from create, link, or setup results: pushes will not trigger compliance until the repo is re-linked.`;
