# @infracodebase/mcp

[![npm version](https://img.shields.io/npm/v/@infracodebase/mcp)](https://www.npmjs.com/package/@infracodebase/mcp)
[![node](https://img.shields.io/node/v/@infracodebase/mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@infracodebase/mcp)](https://github.com/onwardplatforms/infracodebase-mcp/blob/main/LICENSE)

Give your AI coding agent access to [infracodebase](https://infracodebase.com) compliance, rulesets, and governance. This MCP server works with Claude Code, Claude Desktop, Cursor, VS Code, and any other MCP client.

## Prerequisites

- Node.js 20 or newer
- An InfraCodebase account. Enterprise accounts may sign in through Microsoft Entra; SaaS accounts use their normal InfraCodebase sign-in. During login, InfraCodebase guides you to connect a personal version-control account when your enterprise requires one.

## Quickstart

Run one command in your terminal:

```bash
npx -y @infracodebase/mcp@latest init
```

It signs you in through your browser, finds the MCP clients installed on your machine, and adds the server to the ones you pick: Claude Code, Cursor, VS Code, Claude Desktop, Windsurf, or Codex CLI. Running it again is safe. It reuses your saved login and skips clients that are already set up.

Login creates a renewable InfraCodebase session for the CLI. It does not copy a GitHub token or require a PAT. The full guide lives at [infracodebase.com/docs/developers/mcp](https://infracodebase.com/docs/developers/mcp).

### Manual setup

`init` writes these entries for you. To add one by hand, sign in with `npx -y @infracodebase/mcp@latest login`, then:

```bash
claude mcp add infracodebase --scope user -- npx -y @infracodebase/mcp@latest
```

`--scope user` registers the server once for every project. Without it, the server only exists in the directory you ran the command in and shows as disconnected everywhere else.

For Claude Desktop, Cursor, Windsurf, or any other client, add the server to its `mcp.json`:

```json
{
  "mcpServers": {
    "infracodebase": {
      "command": "npx",
      "args": ["-y", "@infracodebase/mcp@latest"]
    }
  }
}
```

## Concepts

A few terms show up throughout the tools.

- Enterprise. Your organization in infracodebase.
- Workspace. A single project, usually one per repo, with its own rules and compliance history.
- Ruleset. A named group of compliance rules that apply to a workspace.
- Evaluation. One compliance run against the code pushed to a workspace's linked branch.

## Tools

The server gives your agent 27 tools, grouped into seven areas. Your saved session is loaded and refreshed locally, so credentials never appear in tool arguments or MCP configuration. When in doubt, start with `get_workspace_context`. Called with no arguments it detects the repo from the client's workspace root or the directory the server was started in, and tells the agent everything it needs to know about that repo. Read-only tools are annotated as such, so clients that honor MCP annotations can run them without a permission prompt.

### Workspace

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_enterprises` | Find the enterprises you can access. | (none) |
| `list_workspaces` | List the projects in an enterprise, and see which repo each one is linked to. One call returns at most 100; `truncated` says when there are more, and `slug` reaches one directly. | `enterprise_id`, `kinds?`, `slug?`, `limit?` |
| `get_workspace_context` | The best place to start. Tells you whether a repo is governed, which rules apply, its coding guidelines, and its latest compliance result. Auto-detects the repo when called with no arguments. For a repo no workspace governs yet, it still returns the enterprise's required rulesets, guidelines, and modules so the agent can draft against them. | `repo_url?` or `workspace_id?`, `iac_tool?`, `enterprise_id?`, `ruleset_ids?` |
| `get_build_rules` | For an unlinked repo, read the rules of the optional rulesets the agent picked from `available_rulesets` without reloading the whole context. | `enterprise_id`, `ruleset_ids?` |

### Rulesets

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_workspace_rulesets` | See every ruleset that could apply to a workspace, including ones it has not turned on yet. | `workspace_id` |
| `get_ruleset_details` | Read the full text of every rule in a ruleset, including the ones that are turned off. `detail: summary` leaves out the rule bodies. | `workspace_id`, `ruleset_id`, `detail?` |

### Compliance

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `get_compliance_evaluation` | Get the result of a compliance run. Shows the latest by default. | `workspace_id`, `ref?`, `branch?` |
| `trigger_compliance_evaluation` | Start a compliance run on the code you have already pushed to the linked branch. | `workspace_id`, `ref?`, `ruleset_id?`, `rule_id?`, `rule_ids?` |
| `list_compliance_findings` | See the pass or fail result for each rule in a run. Returns up to `limit` findings (default 100) and says when more exist. `detail: summary` leaves out the evidence text. | `workspace_id`, `ref?`, `status?`, `ruleset_id?`, `limit?`, `detail?` |
| `wait_for_compliance_evaluation` | Wait for a run to finish and return its result in one call. The waiting happens inside the tool, so the agent never polls. Capped at 25 minutes. | `workspace_id`, `ref?`, `branch?`, `max_wait_minutes?` |
| `get_compliance_eval_spec` | See the exact instructions the compliance checker follows. | `workspace_id` |

### Compliance exceptions

For failing rules the code can't or shouldn't fix. An exception is either a **risk acceptance** (a real violation someone accepts) or **not applicable** (the rule doesn't apply at this level, like a control set per subscription or tenant). Everyone requests by default, and a compliance approver reviews. Approvers can grant directly, but only when they explicitly ask to. Exception decisions are recorded under your name, so they need your own sign-in or personal access token. Enterprise access tokens can't make them.

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_compliance_exceptions` | See active exceptions and requests waiting on an approver. | `workspace_id` |
| `submit_compliance_exceptions` | Request exceptions for a batch of rules, or grant them if you're an approver and say so. | `workspace_id`, `exceptions[]` (`rule_id`, `type`, `justification`, `expires_in_days?`), `grant?` |
| `approve_compliance_exception` | Approve a waiting request. Approvers only. Takes effect immediately. | `workspace_id`, `rule_id` |
| `reject_compliance_exception` | Reject a waiting request with a reason. Approvers only. | `workspace_id`, `rule_id`, `reason` |
| `revoke_compliance_exception` | End an exception so the rule is enforced again. Approvers only. | `workspace_id`, `rule_id` |

### Enterprise resources

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_enterprise_resources` | See the rulesets, MCP servers, and workflows an enterprise offers. | `enterprise_id` |
| `list_modules` | See the approved, reusable infrastructure modules, with their source and version. | `enterprise_id` |
| `list_workspace_modules` | Read stored default-branch module references, versions, freshness, locations and scan metadata. No scan is started. | `workspace_id`, `enterprise_id?`, `status?`, `query?`, `limit?`, `cursor?` |
| `list_module_consumers` | See accessible workspaces that reference an approved module, with versions, locations and scan metadata. | `module_id`, `enterprise_id?`, `status?`, `query?`, `limit?`, `cursor?` |

Module inventory tools return one call site per result, including local sources. Local sources have no independent version pin. Follow `next_cursor` until it is null, even if a filtered page is empty. Missing, stale or incomplete scans are not proof that no references exist. The consumer view covers observed, accessible workspaces, not every repository. Latest stable is not a compatibility verdict. These reads never run compliance, install dependencies, refresh scans or start upgrades.

### Setup

The two-call path for a repo that comes back `unlinked`. Drafting does not wait on it, since the unlinked answer already carries the enterprise's rules, but pushes are not checked until the repo is linked. The plan is read-only and lists the decisions that are yours; the apply step runs only after you confirm.

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `plan_workspace_setup` | Finds the enterprise and connection that can see the repo, checks for an existing workspace, and proposes a workspace, branch, and rulesets (required ones pre-selected). Makes no changes. | `repo_url?`, `enterprise_id?`, `connection_id?` |
| `setup_workspace` | Applies a confirmed plan: creates and links the workspace (or links an existing unlinked one), attaches rulesets, and reloads the context so the agent can write against the rules right away. | `enterprise_id`, `connection_id`, `repo_path`, `branch`, `workspace_name?` or `existing_workspace_id?`, `ruleset_ids?` |

### Version control and manual setup

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_vcs_connections` | See the version-control connections (GitHub, GitLab, ...) an enterprise has. | `enterprise_id`, `provider?` |
| `list_vcs_repos` | See the repos a version-control connection can reach. | `enterprise_id`, `connection_id`, `search?` |
| `create_workspace` | Create a workspace, and optionally attach rules and link a repo. | `enterprise_id`, `name`, resource and repo fields (optional) |
| `link_workspace_to_repo` | Connect a workspace to a repo (any provider) so every push gets checked. | `workspace_id`, `connection_id`, `repo_path`, `branch` |
| `update_workspace_resources` | Attach or detach rulesets, MCP servers, or workflows on a workspace. | `workspace_id`, add and remove id lists |

Most workspace-scoped tools also take an optional `enterprise_id`. It lets the server skip an extra lookup, and you can leave it out.

## Try it

Once connected, prompts like these work well.

- Is this repo governed by infracodebase, and which rulesets apply?
- Set this repo up in infracodebase.
- Run a compliance evaluation on the branch I just pushed.
- Show the failing findings from the latest evaluation.
- Create a workspace for this repo and link it to the main branch.

## Self-hosted

Pass your instance's API URL to `init`. It signs you in to that instance and writes the same URL into every client it sets up, so the two always match.

```bash
npx -y @infracodebase/mcp@latest init --api-url https://infra.your-company.com/api/v1
```

No public npm access? Run it from a clone instead. Build it, then point your client at `node /abs/path/to/dist/index.js --api-url https://infra.your-company.com/api/v1`.

```bash
git clone https://github.com/onwardplatforms/infracodebase-mcp.git
cd infracodebase-mcp && npm install && npm run build
```

## Configuration

Browser login stores OAuth credentials in `~/.config/infracodebase/credentials.json` (or under `XDG_CONFIG_HOME`) with mode `0600`. Sessions are scoped per InfraCodebase instance and refresh automatically. Active sessions remain signed in; login is required again after 90 days without a successful refresh or when access is revoked. Temporary network or service failures are retried and do not remove the saved login. Your MCP client only needs the command; self-hosted clients also provide their API URL. The server talks to your client over stdio.

| Flag              | Env var                 | Default                            |
| ----------------- | ----------------------- | ---------------------------------- |
| `--api-url=<url>` | `INFRACODEBASE_API_URL` | `https://infracodebase.com/api/v1` |

`--token` / `INFRACODEBASE_TOKEN` remains available only as a legacy compatibility override for non-interactive automation.

## Troubleshooting

- Missing or expired session. Run `npx -y @infracodebase/mcp@latest init` (or `login`). If a browser cannot open, add `--no-open` and open the printed URL yourself.
- TLS errors against a self-hosted instance. If your instance uses a private certificate authority, set `NODE_EXTRA_CA_CERTS` to the path of your root certificate.
- `get_workspace_context` returns `unlinked`. No workspace governs the repo yet, so pushes are not checked. The agent can still draft: the answer carries the enterprise's required rulesets, coding guidelines, and modules (`can_generate` says whether it is complete, and `selection_required` asks the agent to pick optional rulesets first). To get pushes checked, ask the agent to set the repo up: `plan_workspace_setup` finds the right enterprise and connection, proposes a workspace and rulesets, and lists the decisions that are yours. Once you confirm, `setup_workspace` creates and links the workspace and reloads the rules. On a self-hosted instance that predates drafting context, `unlinked` comes back without rules and the agent waits for setup, as before.
- `get_workspace_context` returns `needs_enterprise`. You belong to several enterprises and the repo is not linked, so the agent asks which one to draft for and calls again with `enterprise_id`.

## CLI

Use the `npx` form, or `infracodebase` and `infracodebase-mcp` if you installed it globally. Run with no command in a terminal, the CLI starts `init`. Launched by an MCP client, it starts the server.

```bash
npx -y @infracodebase/mcp@latest init     # Sign in and set up your MCP clients
npx -y @infracodebase/mcp@latest start    # Start the server over stdio
npx -y @infracodebase/mcp@latest login    # Sign in and save a renewable session
npx -y @infracodebase/mcp@latest logout   # Revoke and remove the saved session
npx -y @infracodebase/mcp@latest help     # Print full usage
```

For scripted setup, skip the picker with `--client`, for example `init --client claude-code,cursor`.

## Development

```bash
npm install
npm run build
npm run test:run   # unit tests (Vitest)
npm run smoke      # offline test of the MCP protocol layer
```

See [CONTRIBUTING.md](https://github.com/onwardplatforms/infracodebase-mcp/blob/main/CONTRIBUTING.md) for the full guide. MIT licensed.

## Releases

Versions publish to npm automatically. Each release is tagged `vX.Y.Z` with notes generated from the changes in that release. Browse the full changelog on the [GitHub Releases page](https://github.com/onwardplatforms/infracodebase-mcp/releases).
