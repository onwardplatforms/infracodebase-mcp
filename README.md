# @infracodebase/mcp

[![npm version](https://img.shields.io/npm/v/@infracodebase/mcp)](https://www.npmjs.com/package/@infracodebase/mcp)
[![node](https://img.shields.io/node/v/@infracodebase/mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@infracodebase/mcp)](https://github.com/onwardplatforms/infracodebase-mcp/blob/main/LICENSE)

Give your AI coding agent access to [infracodebase](https://infracodebase.com) compliance, rulesets, and governance. This MCP server works with Claude Code, Claude Desktop, Cursor, VS Code, and any other MCP client.

## Prerequisites

- Node.js 20 or newer
- An infracodebase account and an access token from [infracodebase.com/settings/tokens](https://infracodebase.com/settings/tokens). Pick **Read and write** if the agent should be able to set repos up; a read-only token can only inspect.

## Quickstart

Get a token, then connect the server to your MCP client. The one-click buttons set up the config for you, and you add your token afterward. If you would rather set it up by hand, use the snippets below. The full guide lives at [infracodebase.com/docs/developers/mcp](https://infracodebase.com/docs/developers/mcp).

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=infracodebase&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBpbmZyYWNvZGViYXNlL21jcEAyIl0sImVudiI6eyJJTkZSQUNPREVCQVNFX1RPS0VOIjoiaWNiX3BhdF94eHgifX0%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522infracodebase%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540infracodebase%252Fmcp%25402%2522%255D%252C%2522env%2522%253A%257B%2522INFRACODEBASE_TOKEN%2522%253A%2522%2524%257Binput%253Aicb_token%257D%2522%257D%257D)

### Claude Code

```bash
claude mcp add infracodebase --scope user --env INFRACODEBASE_TOKEN=icb_pat_xxx -- npx -y @infracodebase/mcp@2
```

`--scope user` registers the server once for every project. Without it, the server only exists in the directory you ran the command in and shows as disconnected everywhere else.

### Claude Desktop, Cursor, or any other client

Add the server to your `mcp.json`.

```json
{
  "mcpServers": {
    "infracodebase": {
      "command": "npx",
      "args": ["-y", "@infracodebase/mcp@2"],
      "env": { "INFRACODEBASE_TOKEN": "icb_pat_xxx" }
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

The server gives your agent 18 tools, grouped into six areas. Your token comes from the client config, so you never pass credentials as a tool argument. When in doubt, start with `get_workspace_context`. Called with no arguments it detects the repo from the client's workspace root or the directory the server was started in, and tells the agent everything it needs to know about that repo. Read-only tools are annotated as such, so clients that honor MCP annotations can run them without a permission prompt.

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

Add `INFRACODEBASE_API_URL` to the same `env` block, or pass `--api-url`.

```json
"env": {
  "INFRACODEBASE_TOKEN": "icb_pat_xxx",
  "INFRACODEBASE_API_URL": "https://infra.your-company.com/api/v1"
}
```

No public npm access? Run it from a clone instead. Build it, then point your client at `node /abs/path/to/dist/index.js` with the same `env`.

```bash
git clone https://github.com/onwardplatforms/infracodebase-mcp.git
cd infracodebase-mcp && npm install && npm run build
```

## Configuration

The server reads its token and API URL from a command flag first, then an environment variable, then a built-in default. There is no config file to manage. Your MCP client holds these settings and passes them in through `env`. The server talks to your client over stdio, the standard MCP transport, so the client starts the server and exchanges messages on stdin and stdout.

| Flag              | Env var                 | Default                            |
| ----------------- | ----------------------- | ---------------------------------- |
| `--token=<token>` | `INFRACODEBASE_TOKEN`   | required                           |
| `--api-url=<url>` | `INFRACODEBASE_API_URL` | `https://infracodebase.com/api/v1` |

## Troubleshooting

- Missing or invalid token. The server needs `INFRACODEBASE_TOKEN` in its `env`. Generate one at [infracodebase.com/settings/tokens](https://infracodebase.com/settings/tokens).
- TLS errors against a self-hosted instance. If your instance uses a private certificate authority, set `NODE_EXTRA_CA_CERTS` to the path of your root certificate.
- `get_workspace_context` returns `unlinked`. No workspace governs the repo yet, so no rulesets are in force. Ask the agent to set the repo up: `plan_workspace_setup` finds the right enterprise and connection, proposes a workspace and rulesets, and lists the decisions that are yours. Once you confirm, `setup_workspace` creates and links the workspace and reloads the rules before any IaC is written.
- The agent says the token is read-only. Setup tools (create, link, attach rulesets) need a **Read and write** token. Create one at [infracodebase.com/settings/tokens](https://infracodebase.com/settings/tokens) and update `INFRACODEBASE_TOKEN` in your client config.

## CLI

You rarely run this yourself, since your MCP client starts it for you. When you do, use the `npx` form, or `infracodebase` and `infracodebase-mcp` if you installed it globally.

```bash
npx -y @infracodebase/mcp@2          # Start the server over stdio (default)
npx -y @infracodebase/mcp@2 help     # Print full usage
```

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
