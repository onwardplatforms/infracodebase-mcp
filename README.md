# @infracodebase/mcp

[![npm version](https://img.shields.io/npm/v/@infracodebase/mcp)](https://www.npmjs.com/package/@infracodebase/mcp)
[![node](https://img.shields.io/node/v/@infracodebase/mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@infracodebase/mcp)](https://github.com/onwardplatforms/infracodebase-mcp/blob/main/LICENSE)

Give your AI coding agent access to [infracodebase](https://infracodebase.com) compliance, rulesets, and governance. This MCP server works with Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex CLI, Devin, and any other MCP client that can launch a stdio server.

## Prerequisites

- [Node.js](https://nodejs.org) 20.12 or later
- An InfraCodebase account. Enterprise accounts may sign in through Microsoft Entra.

## Setup

### Automatic

```bash
npx -y @infracodebase/mcp@latest init
```

Signs you in through your browser and adds InfraCodebase to the MCP clients on your machine: Claude Code, Cursor, VS Code, Claude Desktop, Windsurf, Devin Desktop, or Codex CLI. Safe to run again.

### Manual

**1. Sign in** with your browser:

```bash
npx -y @infracodebase/mcp@latest login
```

Or [create a token](https://infracodebase.com/settings/tokens) instead. Use a token for agents that run in the cloud, like Devin, and for CI, where browser login can't reach the machine. Choose **Read and write** if the agent should set up repos or request exceptions.

**2. Add the server to your client.**

Claude Code and Codex CLI:

```bash
claude mcp add infracodebase --scope user -- npx -y @infracodebase/mcp@latest
codex mcp add infracodebase -- npx -y @infracodebase/mcp@latest
```

Other clients take this entry in their MCP config file:

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

| Client | Config file |
| --- | --- |
| Cursor | `~/.cursor/mcp.json` |
| VS Code | User `mcp.json` (**MCP: Open User Configuration**); the key is `servers` and the entry adds `"type": "stdio"` |
| Claude Desktop | `claude_desktop_config.json` (**Settings → Developer → Edit Config**) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Devin Desktop | `~/.config/devin/mcp_config.json` (Windows: `%USERPROFILE%\AppData\Roaming\devin\mcp_config.json`) |

<details>
<summary>Devin in the cloud</summary>

In **Customize → MCPs → Add custom MCP**:

| Field | Value |
| --- | --- |
| Transport | `STDIO` |
| Command | `npx` |
| Arguments | `-y` `@infracodebase/mcp@latest` |
| Environment Variables | `INFRACODEBASE_TOKEN` = your token, stored as a secret |

Devin's machine also needs Node.js. Add it to your organization blueprint under **Settings → Environment → Blueprints**:

```yaml
initialize:
  - name: Install Node.js
    uses: github.com/actions/setup-node@v4
    with:
      node-version: "20"
```

</details>

**Using a token?** Add it to the server's environment: `"env": { "INFRACODEBASE_TOKEN": "<your-token>" }` in a JSON config, or `--env INFRACODEBASE_TOKEN=<your-token>` before the `--` for Claude Code and Codex CLI.

> [!NOTE]
> On Windows, MCP clients can't start `npx` directly. Use `"command": "cmd"` and put `"/c", "npx"` at the start of `args` (for Claude Code: `-- cmd /c npx -y …`). `init` does this for you.

Self-hosted? See [Self-hosted](#self-hosted). The full guide lives at [infracodebase.com/docs/developers/mcp](https://infracodebase.com/docs/developers/mcp).

## Concepts

A few terms show up throughout the tools.

- Enterprise. Your organization in infracodebase.
- Workspace. A single project, usually one per repo, with its own rules and compliance history.
- Ruleset. A named group of compliance rules that apply to a workspace.
- Evaluation. One compliance run against the code pushed to a workspace's linked branch.

## Tools

The server gives your agent 18 tools, grouped into six areas. Your saved session is loaded and refreshed locally, so credentials never appear in tool arguments or MCP configuration. When in doubt, start with `get_workspace_context`. Called with no arguments it detects the repo from the client's workspace root or the directory the server was started in, and tells the agent everything it needs to know about that repo. Read-only tools are annotated as such, so clients that honor MCP annotations can run them without a permission prompt.

### Workspace

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_enterprises` | Find the enterprises you can access. | (none) |
| `list_workspaces` | List the projects in an enterprise, and see which repo each one is linked to. | `enterprise_id`, `kinds?` |
| `get_workspace_context` | The best place to start. Tells you whether a repo is governed, which rules apply, its coding guidelines, and its latest compliance result. Auto-detects the repo when called with no arguments. | `repo_url?` or `workspace_id?`, `iac_tool?` |

### Rulesets

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_workspace_rulesets` | See every ruleset that could apply to a workspace, including ones it has not turned on yet. | `workspace_id` |
| `get_ruleset_details` | Read the full text of every rule in a ruleset, including the ones that are turned off. | `workspace_id`, `ruleset_id` |

### Compliance

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `get_compliance_evaluation` | Get the result of a compliance run. Shows the latest by default. | `workspace_id`, `ref?`, `branch?` |
| `trigger_compliance_evaluation` | Start a compliance run on the code you have already pushed to the linked branch. | `workspace_id`, `ref?`, `ruleset_id?`, `rule_id?`, `rule_ids?` |
| `list_compliance_findings` | See the pass or fail result for each rule in a run. | `workspace_id`, `ref?`, `status?` |
| `get_compliance_eval_spec` | See the exact instructions the compliance checker follows. | `workspace_id` |

### Enterprise resources

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_enterprise_resources` | See the rulesets, MCP servers, and workflows an enterprise offers. | `enterprise_id` |
| `list_modules` | See the approved, reusable infrastructure modules, with their source and version. | `enterprise_id` |

### Setup

The two-call path for a repo that comes back `unlinked`. The plan is read-only and lists the decisions that are yours; the apply step runs only after you confirm.

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

Where browser login can't work, such as cloud agents, CI, and other machines without your browser, set `INFRACODEBASE_TOKEN` (or `--token`) to a personal access token. When it is set, it takes precedence over a saved login.

## Troubleshooting

- Missing or expired session. Run `npx -y @infracodebase/mcp@latest init` (or `login`). If a browser cannot open, add `--no-open` and open the printed URL yourself. In Devin or another cloud agent, use a token instead; see [manual setup](#manual).
- `npx: command not found`, or the server never starts. Node.js 20.12 or newer isn't installed where the server runs. Install it and restart your client. For Devin, add Node to the organization blueprint. If a client can't find `npx` even though it's installed (common with `nvm`), set the command to the full path from `which npx` (macOS and Linux) or `where npx` (Windows).
- TLS errors against a self-hosted instance. If your instance uses a private certificate authority, set `NODE_EXTRA_CA_CERTS` to the path of your root certificate.
- `get_workspace_context` returns `unlinked`. No workspace governs the repo yet, so no rulesets are in force. Ask the agent to set the repo up: `plan_workspace_setup` finds the right enterprise and connection, proposes a workspace and rulesets, and lists the decisions that are yours. Once you confirm, `setup_workspace` creates and links the workspace and reloads the rules before any IaC is written.

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
