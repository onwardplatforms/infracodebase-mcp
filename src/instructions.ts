/**
 * Server instructions handed to every MCP client at initialize.
 *
 * With tool search on (the Claude Code default), only tool names and these
 * instructions load at session start. Tool descriptions arrive later, when
 * the model searches for them. So this text has one job first: say when to
 * reach for this server at all. Protocol the agent must follow step by step
 * still lives in tool responses (`message`, `next`, `decisions_needed`),
 * which are never truncated and change without a client upgrade.
 *
 * Claude Code cuts server instructions at 4,096 characters since v2.1.296
 * (2,048 before that) and the model sees nothing past the cut. The budget
 * below leaves headroom under that limit; `instructions.test.ts` enforces it.
 */
export const SERVER_INSTRUCTIONS_BUDGET = 3800;

export const SERVER_INSTRUCTIONS = `Use this server for anything that touches infrastructure-as-code or its governance: Terraform, Pulumi, CloudFormation, Bicep, Kubernetes, Helm, Ansible, compliance scores and findings, rulesets and coding guidelines, approved modules, compliance exceptions, and bringing a repo under infracodebase. Search for its tools whenever the user mentions any of those, even in an empty repo.

Before writing or changing any IaC, call get_workspace_context first, on every IaC turn. It says whether infracodebase governs this repo and which rulesets and coding guidelines apply. Compliance gates are mandatory, not advisory. Deliver the change and prove it complies, rather than finishing quickly.

Read the returned status.
- linked: write against the rulesets and guidelines. They are scoped to the detected branch. On a feature branch they come from its latest completed check, and \`coverage.rulesets_source: workspace_settings\` under automatic discovery means a full check evaluates more rulesets than listed, so never call the list complete.
- unlinked: no rules are in force yet. Do not write IaC. Call plan_workspace_setup (read-only), ask the user the question in \`message\` with the plan's options, call setup_workspace only after they answer, then reload the context.
- no_access or ambiguous: follow \`message\`.

Other entry points. list_modules finds approved modules before you write new infrastructure. list_compliance_findings shows per-rule results, and get_ruleset_details the full rule text. list_workspace_rulesets finds a relevant ruleset the workspace has not attached yet. A response that needs a follow-up carries a \`next\` or \`message\` field. Do what it says.

Evaluations run against pushed code, never your local tree. Commit and push first, pass \`ref\` as the branch name, and prefer scoped runs (rule_ids, rule_id, or ruleset_id). A push to the default branch or to a branch with an open pull request already runs a full evaluation, so call get_compliance_evaluation once before triggering one yourself. Trigger results carry a \`url\` and a \`next\` field. Share the url with the user and stop. Never poll, sleep, or estimate run time.

For failures the code can't or shouldn't fix, offer exceptions. Show the user each rule's type (risk_acceptance or not_applicable) and justification, and call submit_compliance_exceptions only after they agree. It requests review by default. Grant only when the user explicitly says grant. Approving, rejecting, or revoking an exception needs the user's explicit yes each time.

Always relay a \`warning\` or \`repository_error\` from create, link, or setup results. Pushes will not trigger compliance until the repo is re-linked.`;
