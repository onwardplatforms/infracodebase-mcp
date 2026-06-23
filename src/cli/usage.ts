/**
 * Usage / help text for the infracodebase CLI.
 *
 * Kept as a single builder (rather than scattered console.logs) so the help
 * output stays consistent and is easy to keep in sync with the flags below.
 */

export function buildUsage(packageName = "infracodebase"): string {
  return `infracodebase MCP server - brings compliance, rulesets, and governance to your local agent.

Usage: ${packageName} [--token=<token>] [--api-url=<url>]
       ${packageName} init
       ${packageName} auth [status|logout]

Commands:
  (no command)            Start the MCP server over stdio (default)
  init                    One-command setup: validate token, write config,
                          and print client install instructions
  auth status             Show the cached token, who it belongs to, and which
                          enterprises it can access
  auth logout             Remove the cached configuration (~/.infracodebase)
  config get [key]        Print a saved setting, or all of them with no key
  config set <key> <val>  Change a saved setting (api-url)
  help                    Show this help

Authentication:
  --token <token>         infracodebase personal access token (icb_pat_...).
                          Falls back to INFRACODEBASE_TOKEN, then the config file.
  --api-url <url>         API endpoint (default: https://infracodebase.com/api/v1).
                          Use this to point at a self-hosted instance.

Environment variables:
  INFRACODEBASE_TOKEN     Token to use (alternative to --token)
  INFRACODEBASE_API_URL   API endpoint (alternative to --api-url)

Config file:
  ~/.infracodebase/config.json    Persisted token + settings (mode 0600)

Examples:
  # First-time setup (validates the token before saving it)
  INFRACODEBASE_TOKEN=icb_pat_xxx npx @infracodebase/mcp init

  # Check that the cached token still works
  ${packageName} auth status

  # Run the server against a self-hosted instance, token from a flag
  ${packageName} --token=icb_pat_xxx --api-url=https://infra.acme.com/api/v1

Get a token: https://infracodebase.com/settings/tokens
Docs:        https://docs.infracodebase.com/mcp`;
}
