import { clientsFor } from "../setup/clients.js";

/** Build the CLI help text in one place so commands and examples stay aligned. */
export function buildUsage(packageName = "infracodebase"): string {
  return `infracodebase MCP server - brings compliance, rulesets, and governance to your local agent.

Get set up (signs you in and connects your MCP clients):
  npx -y @infracodebase/mcp@latest init

Usage: npx -y @infracodebase/mcp@latest [command] [--api-url=<url>]
       ${packageName} [command] [--api-url=<url>]   (global install)

Commands:
  init              Sign in, then add the server to your MCP clients
  (no command)      In a terminal: same as init. From an MCP client: start the server
  start             Start the MCP server over stdio
  login             Sign in through the browser and save a renewable session
  logout            Remove the saved session for this InfraCodebase instance
  help              Show this help

Options:
  INFRACODEBASE_API_URL / --api-url <url>
        API endpoint. Defaults to https://infracodebase.com/api/v1.
  --client <ids>
        init only: comma-separated clients to set up without prompting.
        One or more of: ${clientsFor(process.platform)
          .map((client) => client.id)
          .join(", ")}
  --no-open
        Print the sign-in URL instead of opening a browser (init and login).
  INFRACODEBASE_TOKEN / --token <token>
        Legacy compatibility override for automation. Browser login is preferred.

Docs: https://infracodebase.com/docs/developers/mcp`;
}
