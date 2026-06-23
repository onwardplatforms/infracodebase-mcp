# @infracodebase/mcp

MCP server bringing [infracodebase](https://infracodebase.com)'s compliance, rulesets, and governance to your AI agent. Works with Claude Code/Desktop, Cursor, or any of your favorite MCP client.

## Quickstart

Get a token from [infracodebase.com/settings/tokens](https://infracodebase.com/settings/tokens), then:

```bash
INFRACODEBASE_TOKEN=your_token npx @infracodebase/mcp init
```

`init` validates the token, saves `~/.infracodebase/config.json`, and prints the command to connect your client. For Claude Code:

```bash
claude mcp add infracodebase -- npx -y @infracodebase/mcp
```

Restart your client. Verify with `infracodebase auth status`.

## Self-hosted

Add `--api-url` (or set `INFRACODEBASE_API_URL`); unset, it targets the SaaS.

```bash
npx @infracodebase/mcp init --token=icb_pat_xxx --api-url=https://infra.your-company.com/api/v1
```

No public npm access? Run from a clone instead - same server:

```bash
git clone https://github.com/infracodebase/mcp.git
cd mcp && pnpm install && pnpm build
node dist/index.js init --token=icb_pat_xxx --api-url=https://infra.your-company.com/api/v1
```

Then point your client at `node /abs/path/to/mcp/dist/index.js` with the same `--api-url`.

## Configuration

Token and API URL resolve from flag → env var → `~/.infracodebase/config.json` → default.

| Flag              | Env var                 | Default                            |
| ----------------- | ----------------------- | ---------------------------------- |
| `--token=<token>` | `INFRACODEBASE_TOKEN`   | required                           |
| `--api-url=<url>` | `INFRACODEBASE_API_URL` | `https://infracodebase.com/api/v1` |

## CLI

```bash
infracodebase                          # Start the server (stdio) - default
infracodebase init                     # Validate token, save config
infracodebase auth status | logout     # Show / remove saved config
infracodebase config get | set <k> <v> # Read / change a setting (api-url)
infracodebase help                     # Full usage
```

## Development

```bash
pnpm install
pnpm build
pnpm smoke   # offline test of the MCP protocol layer
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. MIT licensed.
