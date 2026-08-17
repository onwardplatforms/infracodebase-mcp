# @infracodebase/mcp

[![npm version](https://img.shields.io/npm/v/@infracodebase/mcp)](https://www.npmjs.com/package/@infracodebase/mcp)
[![node](https://img.shields.io/node/v/@infracodebase/mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@infracodebase/mcp)](https://github.com/onwardplatforms/infracodebase-mcp/blob/main/LICENSE)

Give your AI coding agent access to [infracodebase](https://infracodebase.com) compliance, rulesets, and governance. This MCP server works with Claude Code, Claude Desktop, Cursor, VS Code, and any other MCP client.

## Prerequisites

- Node.js 20 or newer
- An infracodebase account and an access token from [infracodebase.com/settings/tokens](https://infracodebase.com/settings/tokens)

## Quickstart

Get a token, then connect the server to your MCP client. The one-click buttons set up the config for you, and you add your token afterward. If you would rather set it up by hand, use the snippets below.

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=infracodebase&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBpbmZyYWNvZGViYXNlL21jcEBsYXRlc3QiXSwiZW52Ijp7IklORlJBQ09ERUJBU0VfVE9LRU4iOiJpY2JfcGF0X3h4eCJ9fQ%3D%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522infracodebase%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540infracodebase%252Fmcp%2540latest%2522%255D%252C%2522env%2522%253A%257B%2522INFRACODEBASE_TOKEN%2522%253A%2522%2524%257Binput%253Aicb_token%257D%2522%257D%257D)

### Claude Code

```bash
claude mcp add infracodebase --env INFRACODEBASE_TOKEN=icb_pat_xxx -- npx -y @infracodebase/mcp@latest
```

### Claude Desktop, Cursor, or any other client

Add the server to your `mcp.json`.

```json
{
  "mcpServers": {
    "infracodebase": {
      "command": "npx",
      "args": ["-y", "@infracodebase/mcp@latest"],
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

The server gives your agent 16 tools, grouped into five areas. Your token comes from the client config, so you never pass credentials as a tool argument. When in doubt, start with `get_workspace_context`. It tells the agent everything it needs to know about a repo.

### Workspace

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_enterprises` | Find the enterprises you can access. | (none) |
| `list_workspaces` | List the projects in an enterprise, and see which repo each one is linked to. | `enterprise_id`, `kinds?` |
| `get_workspace_context` | The best place to start. Tells you whether a repo is governed, which rules apply, its coding guidelines, and its latest compliance result. | `workspace_id?` or `repo_url?`, `iac_tool?` |

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

### GitHub and setup

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_github_installations` | See which GitHub App installations an enterprise has. | `enterprise_id` |
| `list_github_repos` | See the repos a GitHub App installation can reach. | `enterprise_id`, `installation_id`, `search?` |
| `create_workspace` | Create a workspace, and optionally attach rules and link a repo. | `enterprise_id`, `name`, resource and repo fields (optional) |
| `link_workspace_to_repo` | Connect a workspace to a GitHub repo so every push gets checked. | `workspace_id`, `github_installation_id`, `github_owner`, `github_repo`, `github_branch` |
| `update_workspace_resources` | Attach or detach rulesets, MCP servers, or workflows on a workspace. | `workspace_id`, add and remove id lists |

Most workspace-scoped tools also take an optional `enterprise_id`. It lets the server skip an extra lookup, and you can leave it out.

## Try it

Once connected, prompts like these work well.

- Is this repo governed by infracodebase, and which rulesets apply?
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
- `get_workspace_context` returns `unlinked`. No workspace matches the repo yet. Create one with `create_workspace`, or link an existing one with `link_workspace_to_repo`.

## CLI

You rarely run this yourself, since your MCP client starts it for you. When you do, use the `npx` form, or `infracodebase` and `infracodebase-mcp` if you installed it globally.

```bash
npx -y @infracodebase/mcp@latest          # Start the server over stdio (default)
npx -y @infracodebase/mcp@latest help     # Print full usage
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
