# Infracodebase MCP Server

[Infracodebase](https://infracodebase.com) is the operating system for enterprise cloud. This [MCP](https://modelcontextprotocol.io) server brings it into your IDE.

Your AI agent gets the same governance context Infracodebase applies in CI. Your organization's coding guidelines. The rulesets that govern each repo. The latest compliance findings.

The agent does the work. Infracodebase makes sure the output is aligned with your standards. Read the [launch post](https://infracodebase.com/blog/introducing-the-mcp-server) for the longer version.

The server is **remote**, **hosted**, and lives at:

```
https://infracodebase.com/api/mcp
```

Auth is a personal access token. No SDK to install, no Docker image to run. Read-only by default.

---

## What this unlocks

Once the server is connected, your agent can:

- Resolve any local repo to its Infracodebase workspace and load the rulesets that govern it.
- Read the full text of any required ruleset and apply rules as hard constraints while writing IaC.
- Pull the latest CI compliance findings before recommending a push, so the developer isn't surprised when the gate runs.
- Cite the exact ruleset and rule that drove a code change.
- (With write scope) bootstrap a workspace for a new repo and attach the right rulesets, MCP servers, and workflows.

Works across *any* IaC. Terraform, Pulumi, CloudFormation, Ansible.

---

## Quick install

You'll need a token. Create one at **Settings → Personal Access Tokens** in the Infracodebase web app. Pick `Read-only` unless you want the agent to be able to create or modify workspaces. Full setup walkthrough is in the [docs](https://infracodebase.com/docs/developers/mcp-access).

### Claude Code

```bash
claude mcp add --scope user --transport http infracodebase https://infracodebase.com/api/mcp \
  --header "Authorization: Bearer $ICB_TOKEN"
```

The `--scope user` flag registers the server for every project on this machine, not just the current one.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "infracodebase": {
      "url": "https://infracodebase.com/api/mcp",
      "headers": { "Authorization": "Bearer ICB_TOKEN" }
    }
  }
}
```

Restart Claude Desktop.

### Cursor

Edit `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your repo root for project scope):

```json
{
  "mcpServers": {
    "infracodebase": {
      "url": "https://infracodebase.com/api/mcp",
      "headers": { "Authorization": "Bearer ICB_TOKEN" }
    }
  }
}
```

Restart Cursor.

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json` (or use the in-app MCP settings):

```json
{
  "mcpServers": {
    "infracodebase": {
      "serverUrl": "https://infracodebase.com/api/mcp",
      "headers": { "Authorization": "Bearer ICB_TOKEN" }
    }
  }
}
```

Restart Windsurf.

### Other clients

Any MCP client that speaks Streamable HTTP works. Point it at `https://infracodebase.com/api/mcp` and pass `Authorization: Bearer <token>`.

### Verify the connection

In Claude Code: `claude mcp list` should show `infracodebase` as `connected`. Then ask the agent:

> Call `list_enterprises` and tell me what comes back.

You should see the enterprises your user is a member of. If you get an auth error, the token is wrong or expired. If you get an empty list, your account isn't a member of any enterprise yet.

For lower-level debugging, point [MCP Inspector](https://github.com/modelcontextprotocol/inspector) at `https://infracodebase.com/api/mcp` with the same `Authorization` header.

---

## Add a rules file

The web app's token-creation dialog also generates a small rules file (`CLAUDE.md`, `.cursor/rules/infracodebase.mdc`, or `.windsurfrules`) for you to commit to your repo. We strongly recommend doing this. It does two things:

1. Forces the agent to call `get_workspace_context` *before* writing any infrastructure code, so it loads the rulesets that govern the repo.
2. Survives long sessions and flaky network connections. If the MCP connection blips, the rules file is still in the repo.

A representative `CLAUDE.md`:

```markdown
This repo is governed by infracodebase. The `infracodebase` MCP server exposes
the org's coding guidelines, rulesets, and CI compliance state.

Before writing or modifying any infrastructure-as-code (Terraform, Pulumi,
CloudFormation, Bicep, Kubernetes, Ansible):

1. Call `get_workspace_context` first. Pass the git remote URL.
2. For every ruleset returned with `required: true`, call `get_ruleset_details`
   and treat the rules as hard constraints.
3. Cite the ruleset and rule when one drives a decision.
4. Before suggesting a push, call `list_compliance_findings`.
```

The dialog in the app generates the full version with the workspace-bootstrapping flow included. Copy from there.

---

## Authentication

- Token format: `icb_pat_<random>`
- Header: `Authorization: Bearer <token>`
- Scopes:
  - `read`: call any of the read tools below
  - `execute`: also call `create_workspace`, `link_workspace_to_repo`, `update_workspace_resources`
- Expiry: 7 / 30 / 90 / 365 days, or never. 90 is the default.
- Tokens are **user-scoped**, not enterprise-scoped. One token covers everything the user can see across all of their enterprises.
- Authorization is **live**. Permission changes in the web UI take effect on the next MCP call; nothing is cached.

The secret is shown exactly once at creation time. Revoke any token from the same settings page.

---

## Tools

### Read (always available)

| Tool | What it returns |
| --- | --- |
| `get_workspace_context` | The front door. Resolves a git remote URL to a workspace, returns identity, coding guidelines, ruleset metadata, and current compliance state. |
| `get_ruleset_details` | Full rule contents for one ruleset (drill-down by id). |
| `get_compliance_evaluation` | Compliance evaluation summary. Latest, or pinned to an `evaluation_id` / commit SHA. |
| `list_compliance_findings` | Per-rule findings from a compliance evaluation, with filters. |
| `get_compliance_eval_spec` | The system prompt Infracodebase's CI evaluator uses, so the local agent can reason the same way. |
| `list_enterprises` | Enterprises the user belongs to, with role and workspace count. |
| `list_workspaces` | Workspaces the user can access, optionally filtered by enterprise. |
| `list_enterprise_resources` | Rulesets, MCP servers, and workflows available to attach to a workspace. |
| `list_github_installations` | GitHub orgs the enterprise is connected to. |
| `list_github_repos` | Repos visible through a GitHub connection. |

### Write (requires `execute` scope)

| Tool | What it does |
| --- | --- |
| `create_workspace` | Create a workspace, attach resources, optionally link a GitHub repo in one call. |
| `link_workspace_to_repo` | Connect an existing workspace to a GitHub repo. |
| `update_workspace_resources` | Add or remove rulesets, MCP servers, and workflows on a workspace. |

The write tools are scoped behind explicit token selection at creation time. A read-only token will reject these calls. The agent can't escalate its own permissions.

---

## How this differs from most MCP servers

Most product MCP servers wrap an API. This one is a **governance data registry**: the local agent does the writing, and Infracodebase hands it the rules, guidelines, and CI state it needs to write correctly. We don't run a remote agent. We don't generate IaC for you. We make sure the agent you're already using knows what your org expects.

The canonical enforcement gate is still CI. Compliance is evaluated server-side on push using the same rules the agent loaded over MCP, so the agent and the gate agree on what "compliant" means. Speed and compliance stop being a tradeoff.

Built for the governance, security, and operational requirements of regulated environments. Financial services. Healthcare. Defense. Critical infrastructure.

---

## Security

MCP gives an AI agent the ability to call tools on your behalf. Treat that like any other credential surface.

- **Default to a read-only token.** Only mint an `execute`-scope token when you specifically want the agent to create or modify workspaces. A compromised read-only token can read your governance data; an `execute` token can change which rulesets are attached to a workspace.
- **Tokens are user-scoped.** Anyone with your token has the same visibility you have, across every enterprise you belong to. Don't share.
- **Prompt injection is real.** A malicious actor could embed instructions in any text the agent reads (a README, a PR comment, a ruleset description) that try to get the agent to call `update_workspace_resources` and weaken the gates. Mitigations: use read-only tokens for day-to-day work, keep "ask before tool use" enabled in your client, and review write-tool calls before approving.
- **Rotate.** Token expiry defaults to 90 days. Pick a shorter window for shared machines.
- **Revoke immediately if leaked.** Settings → Personal Access Tokens → Revoke. Authorization is live; the next call from that token will fail.

Found a vulnerability? Reach out via the contact form at [infracodebase.com](https://infracodebase.com) and we'll route it to the team.

---

## License

MIT.
