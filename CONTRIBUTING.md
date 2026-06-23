# Contributing

Thanks for contributing to `@infracodebase/mcp`! This guide covers getting set
up and **testing the server locally** before you publish or open a PR.

## Prerequisites

- **Node.js ≥ 20** (see `engines` in `package.json`)
- An infracodebase API token for live testing - get one at
  https://infracodebase.com/settings/tokens

## Setup

```bash
git clone https://github.com/onwardplatforms/infracodebase-mcp.git
cd infracodebase-mcp
npm install
npm build          # compiles src/ → dist/ with tsc
```

For an auto-rebuild loop while developing, run the watcher in a second terminal:

```bash
npm dev            # tsc --watch
```

## Project layout

```
src/
├── index.ts            CLI entry point (commands, flag parsing)
├── server.ts           MCP server setup + stdio transport
├── config.ts           ~/.infracodebase/config.json load/save, token resolution
├── client.ts           REST API client (auth, ApiError)
├── cli/
│   ├── usage.ts        `help` / usage text
│   ├── config.ts       `config get` / `config set`
│   └── auth.ts         `auth status` / `auth logout`
└── tools/
    ├── index.ts        All 14 MCP tools: one tools/call + one tools/list handler
    └── validation.ts   Zod arg schemas + repo-URL parsing
```

## Testing locally

The published install uses `npx @infracodebase/mcp`. Locally you skip npx
and hit your built entry point instead. There are three equivalents - pick one:

```bash
# 1. Run the built entry point directly
INFRACODEBASE_TOKEN=your_token node dist/index.js init

# 2. dist/index.js has a shebang and is marked as a bin, so after `npm build`:
INFRACODEBASE_TOKEN=your_token ./dist/index.js init

# 3. Put the real `infracodebase` command on your PATH (mimics a global install)
npm link                                       # once
INFRACODEBASE_TOKEN=your_token infracodebase init
#   undo later with: npm unlink -g @infracodebase/mcp
```

`init` **validates the token against the API before saving** it to
`~/.infracodebase/config.json`. Confirm it worked:

```bash
node dist/index.js auth status      # → ✓ valid + the enterprises the token can see
```

### 1. Offline smoke test (no token, no network)

`initialize` and `tools/list` don't touch the API, so you can verify the MCP
protocol layer anywhere - handy in CI or on a plane:

```bash
npm smoke
```

This builds, performs the `initialize` handshake, and asserts `tools/list`
returns all 14 tools. It exits non-zero on failure, so it's safe to wire into
CI. (See `scripts/smoke.mjs`.)

### 2. Drive the tools interactively - MCP Inspector

The fastest way to exercise real tool calls is the official Inspector, which
gives you a web UI to invoke each tool with arguments:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Try `get_workspace_context` with `{ "repo_url": "owner/name" }` to watch the
repo → workspace → context resolution, or pass bad arguments to any tool to see
the Zod validation messages.

### 3. End-to-end in Claude Code

Point Claude Code at your **local build** (not the published package). Use a
distinct server name like `-dev` so it doesn't collide with a hosted server:

```bash
claude mcp add infracodebase-dev -- node /absolute/path/to/dist/index.js
# remove when done:
claude mcp remove infracodebase-dev
```

It reads the token from `~/.infracodebase/config.json`. Start a session in any
repo, ask Claude to write some Terraform, and confirm it calls
`get_workspace_context` first.

## Before opening a PR

```bash
npm lint           # oxlint
npm smoke          # builds + asserts the MCP protocol layer
```

If your change touches API behavior, also exercise it through the Inspector with
a real token.

## Publishing (maintainers)

```bash
# bump version in package.json, then:
npm build
npm publish --access public
```
