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

export const SERVER_INSTRUCTIONS = `Before writing or changing any infrastructure-as-code (Terraform, Pulumi, CloudFormation, Bicep, Kubernetes, Helm, Ansible), including bootstrapping IaC in an empty repo, call get_workspace_context first, on every IaC turn. It says whether this repo is governed by infracodebase and which rulesets and coding guidelines apply. Compliance gates here are mandatory, not advisory: the job is to deliver the change and prove it complies, not to finish quickly.

Read the returned status:
- linked: you hold the rulesets and guidelines. Write against them.
- unlinked: no rules are in force yet. Do not write IaC. Call plan_workspace_setup (read-only), ask the user the question in \`message\` using the plan's options, and call setup_workspace only after they answer. Then reload the context.
- no_access or ambiguous: follow \`message\`.

Compliance evaluations run against code pushed to the linked branch, never your local tree. Commit and push first, pass \`ref\` as the branch name, and prefer scoped runs: a push to the default branch or to a branch with an open pull request already auto-runs a full evaluation. Trigger results carry a \`url\` and a \`next\` field. Share the url with the user and stop; never poll, sleep, or estimate how long a run will take.

Always relay a \`warning\` or \`repository_error\` from create, link, or setup results: they mean pushes will not trigger compliance until the repo is re-linked.`;
