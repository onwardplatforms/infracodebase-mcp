/** Build the CLI help text in one place so commands and examples stay aligned. */
export function buildUsage(packageName = "infracodebase"): string {
  return `infracodebase MCP server - brings compliance, rulesets, and governance to your local agent.

Sign in once, then let your MCP client start the server without a token:
  npx -y @infracodebase/mcp@2 login

Usage: npx -y @infracodebase/mcp@2 [command] [--api-url=<url>]
       ${packageName} [command] [--api-url=<url>]   (global install)

Commands:
  (no command)      Start the MCP server over stdio (default)
  login             Sign in through the browser and save a renewable session
  logout            Remove the saved session for this InfraCodebase instance
  help              Show this help

Options:
  INFRACODEBASE_API_URL / --api-url <url>
        API endpoint. Defaults to https://infracodebase.com/api/v1.
  INFRACODEBASE_TOKEN / --token <token>
        Legacy compatibility override for automation. Browser login is preferred.
  --no-open
        Print the authorization URL instead of opening a browser (login only).

Add to your MCP client after login (e.g. Claude Desktop / Cursor mcp.json):
  {
    "mcpServers": {
      "infracodebase": {
        "command": "npx",
        "args": ["-y", "@infracodebase/mcp@2"]
      }
    }
  }

Or with Claude Code:
  claude mcp add infracodebase --scope user -- npx -y @infracodebase/mcp@2

Docs: https://infracodebase.com/docs/developers/mcp`;
}
