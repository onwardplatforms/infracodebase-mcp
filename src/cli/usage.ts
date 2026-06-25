/**
 * Usage / help text for the infracodebase CLI.
 *
 * Kept as a single builder (rather than scattered console.logs) so the help
 * output stays consistent and is easy to keep in sync with the flags below.
 */

export function buildUsage(packageName = "infracodebase"): string {
  return `infracodebase MCP server - brings compliance, rulesets, and governance to your local agent.

You normally never run this by hand - your MCP client spawns it (see below).
Invoke it directly via npx, or as '${packageName}' if installed globally:

Usage: npx -y @infracodebase/mcp@latest [--token=<token>] [--api-url=<url>]
       ${packageName} [--token=<token>] [--api-url=<url>]   (global install)

Commands:
  (no command)      Start the MCP server over stdio (default)
  help              Show this help

Authentication (set in your MCP client's config, or pass as flags):
  INFRACODEBASE_TOKEN / --token <token>
        infracodebase personal access token (icb_pat_...). Required.
  INFRACODEBASE_API_URL / --api-url <url>
        API endpoint. Defaults to ${"https://infracodebase.com/api/v1"};
        point it at a self-hosted instance if needed.

Add to your MCP client (e.g. Claude Desktop / Cursor mcp.json):
  {
    "mcpServers": {
      "infracodebase": {
        "command": "npx",
        "args": ["-y", "@infracodebase/mcp@latest"],
        "env": { "INFRACODEBASE_TOKEN": "icb_pat_..." }
      }
    }
  }

Or with Claude Code:
  claude mcp add infracodebase --env INFRACODEBASE_TOKEN=icb_pat_... -- npx -y @infracodebase/mcp@latest

Get a token: https://infracodebase.com/settings/tokens
Docs:        https://docs.infracodebase.com/mcp`;
}
