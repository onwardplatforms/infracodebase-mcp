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
npm run build      # compiles src/ → dist/ with tsc
```

For an auto-rebuild loop while developing, run the watcher in a second terminal:

```bash
npm run dev        # tsc --watch
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
    ├── index.ts            Self-documenting TOOLS[] registry + registerAllTools
    ├── helpers.ts          ToolContext, the registerTool wrapper, shared resolution
    ├── validation.ts       Zod arg schemas, descriptions, repo-URL parsing
    └── <tool_name>.ts       One file per MCP tool (e.g. get_workspace_context.ts)
```

Each tool lives in its own file and exports a `ToolDef`. To add a tool: create
`src/tools/<name>.ts`, add its schema + description to `validation.ts`, and add
its export to the `TOOLS` array in `index.ts`. A colocated
`src/tools/<name>.test.ts` covers it.

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

### 1. Unit tests (Vitest)

Every tool has a colocated `*.test.ts` that exercises its handler against a
mocked client - no token or network needed:

```bash
npm run test:run   # run once (used in CI)
npm test           # watch mode while developing
```

### 2. Offline smoke test (no token, no network)

`initialize` and `tools/list` don't touch the API, so you can verify the MCP
protocol layer anywhere - handy in CI or on a plane:

```bash
npm run smoke
```

This builds, performs the `initialize` handshake, and asserts `tools/list`
returns all 14 tools. It exits non-zero on failure, so it's safe to wire into
CI. (See `scripts/smoke.mjs`.)

### 3. Drive the tools interactively - MCP Inspector

The fastest way to exercise real tool calls is the official Inspector, which
gives you a web UI to invoke each tool with arguments:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Try `get_workspace_context` with `{ "repo_url": "owner/name" }` to watch the
repo → workspace → context resolution, or pass bad arguments to any tool to see
the Zod validation messages.

### 4. End-to-end in Claude Code

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
npm run lint       # oxlint
npm run test:run   # unit tests
npm run smoke      # builds + asserts the MCP protocol layer
```

CI runs these same checks (`.github/workflows/ci.yml`) on every PR. If your
change touches API behavior, also exercise it through the Inspector with a real
token.

## Releases (maintainers)

Releases are automated and AI-assisted, mirroring the main application's release
process. You do **not** bump the version by hand or run `npm publish` yourself.

On every push to `main` (`.github/workflows/release.yml`):

1. **test** - lint, unit tests, build, and smoke test gate the release.
2. **release** - Claude reads the commits and diff since the last `v*` tag,
   classifies the change as patch/minor/major, computes the next semantic
   version, and writes user-facing release notes. The job then creates the
   `vX.Y.Z` git tag and a GitHub Release with those notes.
3. Creating the Release fires `.github/workflows/publish.yml`, which sets
   `package.json` to the tag's version and publishes to npm with provenance.

So the AI-decided version is the single source of truth for the git tag, the
GitHub Release, and the npm package version.

### Manual control

Trigger `release.yml` via **workflow_dispatch** to:

- `version_override` - force a specific version, bypassing the AI decision.
- `dry_run` - generate and print the notes without tagging or publishing.

### Required repository secrets

Both must be set under **Settings → Secrets and variables → Actions**:

| Secret              | Used by       | Purpose                                              |
| ------------------- | ------------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY` | `release.yml` | Generate the version decision and release notes.     |
| `NPM_TOKEN`         | `publish.yml` | npm automation token with publish access to publish. |
