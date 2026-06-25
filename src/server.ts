/**
 * MCP server setup and tool registration
 *
 * This is the user-hosted MCP server that runs locally via stdio transport
 * and calls the infracodebase REST API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "./config.js";
import { InfracodebaseClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";
import { VERSION } from "./version.js";

// Same instructions as the hosted MCP server
const SERVER_INSTRUCTIONS = `**Before writing or modifying any infrastructure-as-code in this session - Terraform, Pulumi, CloudFormation, Bicep, Kubernetes manifests, Helm, Ansible - including bootstrapping IaC in an empty repo, you MUST call \`get_workspace_context\` first.** The result tells you whether this repo is governed by infracodebase and which rulesets apply. This trigger holds for every IaC turn, not just session start.

You are connected to infracodebase, a governance and compliance platform for infrastructure-as-code. This server gives you access to the organization's coding guidelines, rulesets, compliance state, and the ability to create new workspaces.

YOUR ROLE

You are operating in a regulated environment where compliance gates are mandatory, not advisory. The "MUST" statements in this protocol are not suggestions - skipping any of them is a failure of your role here, regardless of how minor a change seems or how naturally the conversation pulls toward declaring the task done. "Deliver the feature quickly" is the wrong priority in this context; "deliver the feature and prove it complies" is the right one.

[Full instructions continue from the hosted MCP server - see lib/mcp/adapters/external.ts]`;

export interface ServerContext {
  client: InfracodebaseClient;
  // Maps a known workspace back to its enterprise to avoid repeated API calls
  workspaceEnterpriseMap: Map<string, string>;
}

/**
 * Create and configure the MCP server
 */
export async function createServer(config: Config): Promise<{
  server: McpServer;
  transport: StdioServerTransport;
  context: ServerContext;
}> {
  const server = new McpServer(
    { name: "infracodebase", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );

  const client = new InfracodebaseClient({
    baseUrl: config.apiUrl,
    token: config.apiToken,
  });

  const context: ServerContext = {
    client,
    workspaceEnterpriseMap: new Map(),
  };

  // Register all tools with consolidated handlers
  await registerAllTools(server, context);

  // Create stdio transport
  const transport = new StdioServerTransport();

  return { server, transport, context };
}

const log = (msg: string) => console.error(`[infracodebase-mcp] ${msg}`);

/**
 * Best-effort auth check at startup. Non-blocking and silent on success - only
 * logs when something is wrong, distinguishing auth failures (401/403) from
 * connectivity failures (bad host/DNS/network) so the warning points at the
 * right fix. Never prevents startup, so a token that recovers mid-session
 * still works.
 */
async function preflight(client: InfracodebaseClient, apiUrl: string): Promise<void> {
  try {
    await client.verifyToken();
    log(`Ready - connected to ${apiUrl}`);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      log(`⚠ token rejected (HTTP ${status}) - invalid or expired`);
      log(`  Check INFRACODEBASE_TOKEN; get a fresh token at https://infracodebase.com/settings/tokens`);
    } else {
      log(`⚠ could not reach ${apiUrl}`);
      log(`  Wrong endpoint? Set INFRACODEBASE_API_URL (or --api-url) to the correct URL.`);
    }
  }
}

/**
 * Start the MCP server
 */
export async function startServer(config: Config): Promise<void> {
  const { server, transport, context } = await createServer(config);

  // Log to stderr (stdout is used for MCP protocol)
  log("Server starting...");

  await server.connect(transport);

  // The health check reports the single source of truth: either
  // "Ready - connected to <url>" or a warning. Non-blocking, so the stdio
  // transport (already live above) stays up even if the API is down.
  void preflight(context.client, config.apiUrl);
}
