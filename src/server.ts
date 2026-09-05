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
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { registerAllTools } from "./tools/index.js";
import { VERSION } from "./version.js";

export interface ServerContext {
  client: InfracodebaseClient;
  // Maps a known workspace back to its enterprise to avoid repeated API calls
  workspaceEnterpriseMap: Map<string, string>;
  /**
   * The workspace roots the connected client advertises (file:// URIs), used
   * to detect the current repo when a tool is called without repo_url. Empty
   * when the client does not support roots.
   */
  listRoots?: () => Promise<string[]>;
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
 * Best-effort auth check at startup. Non-blocking. On success it reports who
 * the token belongs to, so the one line in the client's MCP log is enough to
 * confirm the right account and instance. On failure it distinguishes auth
 * failures (401/403) from connectivity failures (bad host/DNS/network) so the
 * warning points at the right fix. Never prevents startup, so a token that
 * recovers mid-session still works.
 */
async function preflight(client: InfracodebaseClient, apiUrl: string): Promise<void> {
  try {
    const me = await client.verifyToken();
    const who = me.email ? ` as ${me.email}` : "";
    const count = me.enterprises?.length;
    const enterprises =
      typeof count === "number" ? ` (${count} enterprise${count === 1 ? "" : "s"})` : "";
    log(`Ready - connected to ${apiUrl}${who}${enterprises}`);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      log(`⚠ token rejected (HTTP ${status}) - invalid or expired`);
      log(`  Check INFRACODEBASE_TOKEN; get a fresh token at ${tokensPage(apiUrl)}`);
    } else {
      log(`⚠ could not reach ${apiUrl}`);
      log(`  Wrong endpoint? Set INFRACODEBASE_API_URL (or --api-url) to the correct URL.`);
    }
  }
}

function tokensPage(apiUrl: string): string {
  try {
    return `${new URL(apiUrl).origin}/settings/tokens`;
  } catch {
    return "https://infracodebase.com/settings/tokens";
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
  // "Ready - connected to <url> as <who>" or a warning. Non-blocking, so the
  // stdio transport (already live above) stays up even if the API is down.
  void preflight(context.client, config.apiUrl);
}
