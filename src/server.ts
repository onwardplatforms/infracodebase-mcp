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

import { SERVER_INSTRUCTIONS } from "./instructions.js";

export interface ServerContext {
  listRoots?: () => Promise<string[]>;
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
    listRoots: async () => {
      if (!server.server.getClientCapabilities()?.roots) return [];
      const { roots } = await server.server.listRoots();
      return roots.map((root) => root.uri);
    },
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
      log(
        `  Check INFRACODEBASE_TOKEN; get a fresh token at https://infracodebase.com/settings/tokens`
      );
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
