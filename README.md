# @infracodebase/mcp

MCP server bringing [infracodebase](https://infracodebase.com)'s compliance, rulesets, and governance to your AI agent. Works with Claude Code/Desktop, Cursor, or any of your favorite MCP client.

## Quickstart

Get a token from [infracodebase.com/settings/tokens](https://infracodebase.com/settings/tokens), then add the server to your MCP client with the token in its `env`.

For Claude Code:

```bash
claude mcp add infracodebase --env INFRACODEBASE_TOKEN=icb_pat_xxx -- npx -y @infracodebase/mcp@latest
```

For Claude Desktop / Cursor and other clients, add to your `mcp.json`:

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

## Self-hosted

Add `INFRACODEBASE_API_URL` to the same `env` block (or pass `--api-url`)

```json
"env": {
  "INFRACODEBASE_TOKEN": "icb_pat_xxx",
  "INFRACODEBASE_API_URL": "https://infra.your-company.com/api/v1"
}
```

No public npm access? Run from a clone instead - same server. Build it, then point your client at `node /abs/path/to/mcp/dist/index.js` with the same `env`:

```bash
git clone https://github.com/onwardplatforms/infracodebase-mcp.git
cd infracodebase-mcp && npm install && npm run build
```

## Configuration

Token and API URL resolve from flag → env var → default. There is no stored
config file: the MCP client owns the configuration and passes it in via `env`.

| Flag              | Env var                 | Default                            |
| ----------------- | ----------------------- | ---------------------------------- |
| `--token=<token>` | `INFRACODEBASE_TOKEN`   | required                           |
| `--api-url=<url>` | `INFRACODEBASE_API_URL` | `https://infracodebase.com/api/v1` |

## CLI

You rarely run this directly - your MCP client spawns it. When you do, use the
`npx` form (or `infracodebase` / `infracodebase-mcp` if installed globally):

```bash
npx -y @infracodebase/mcp@latest          # Start the server (stdio) - default
npx -y @infracodebase/mcp@latest help     # Full usage
```

## Development

```bash
npm install
npm run build
npm run test:run   # unit tests (Vitest)
npm run smoke      # offline test of the MCP protocol layer
```

See [CONTRIBUTING.md](https://github.com/onwardplatforms/infracodebase-mcp/blob/main/CONTRIBUTING.md)
for the full guide. MIT licensed.

## Releases

Versions are published to npm automatically. Each release is tagged `vX.Y.Z`
with notes generated from the changes in that release - browse the full
changelog on the
[GitHub Releases page](https://github.com/onwardplatforms/infracodebase-mcp/releases).
