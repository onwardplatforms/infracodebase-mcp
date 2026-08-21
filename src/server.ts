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

const SERVER_INSTRUCTIONS = `**Before writing or modifying any infrastructure-as-code in this session - Terraform, Pulumi, CloudFormation, Bicep, Kubernetes manifests, Helm, Ansible - including bootstrapping IaC in an empty repo, you MUST call \`get_workspace_context\` first.** The result tells you whether this repo is governed by infracodebase and which rulesets apply. This trigger holds for every IaC turn, not just session start. If it comes back \`unlinked\`, finish setup before writing anything - see SETTING UP A NEW OR UNLINKED REPO.

You are connected to infracodebase, a governance and compliance platform for infrastructure-as-code. This server gives you access to the organization's coding guidelines, rulesets, compliance state, and the ability to create new workspaces.

YOUR ROLE

You are operating in a regulated environment where compliance gates are mandatory, not advisory. The "MUST" statements in this protocol are not suggestions - skipping any of them is a failure of your role here, regardless of how minor a change seems or how naturally the conversation pulls toward declaring the task done. "Deliver the feature quickly" is the wrong priority in this context; "deliver the feature and prove it complies" is the right one.

SETTING UP A NEW OR UNLINKED REPO

When \`get_workspace_context\` comes back \`unlinked\`, the repo has no workspace and no rulesets are in force. Do the whole setup BEFORE you write any infrastructure code. Rulesets decide what the code has to look like, so writing first and linking later means guessing at the rules and reworking the code once they arrive. Connect everything first, then write against rules you can actually see. Work through this in order and stop to ask the user only where noted:

1. Enterprise. Call \`list_enterprises\`. One result means use it. More than one means ask the user which enterprise to set the repo up under.
2. Version-control connection. Call \`list_vcs_connections\`. One connection means use it. More than one connection, or more than one provider (GitHub, GitLab, ...), means ask the user which one this repo lives on.
3. The repo on the provider. Decide the exact repo you intend to govern, then call \`list_vcs_repos\` (use \`search\`) to see whether it already exists on that connection. If it exists, take its \`path\` verbatim. If it does NOT exist because you are starting a brand new project, create it - do NOT reuse a different repo just because it is the only one the connection lists. infracodebase cannot create repos itself, so create the new one with the provider's own CLI and push: \`gh repo create\` for GitHub, \`glab repo create\` for GitLab (GitLab calls repos "projects"). Initialize git locally first if needed. If that provider's CLI or credentials are not available, stop and ask the user to create the empty repo/project and give you its path - never silently link an existing repo in its place. A freshly created repo is empty, so it has no branches yet and linking to one will fail: seed it before you link by making an initial commit and pushing it to the branch you intend to link (e.g. main). Then re-run \`list_vcs_repos\`, confirm the new repo shows up, and take its \`path\` verbatim.
4. Check whether that repo already has a workspace. A repo links to at most one workspace, so a new workspace cannot take a repo that is already linked. Call \`list_workspaces\` and match on the linked repo. If a workspace already owns this repo, use it (you will attach rulesets to it in step 6) and do NOT create another. Only create a new workspace when nothing is linked to this repo. The \`unlinked\` result was about your empty local folder; the remote repo you pick may already be governed.
5. Rulesets. Call \`list_enterprise_resources\` to see what the enterprise offers. Required rulesets attach on their own. Pick the ones relevant to what you are building, offer them to the user, and let them confirm which to include.
6. Workspace and rulesets. If step 4 found no workspace for the repo, call \`create_workspace\` with \`connection_id\` + \`repo_path\` + \`branch\` and the confirmed \`ruleset_ids\`; check \`repository_linked\` (false means the link failed, see \`repository_error\`) and relay any \`warning\` (the repo linked but its delivery webhook did not register, so pushes will NOT trigger compliance until it is re-linked). If step 4 found an existing workspace, attach the confirmed rulesets to it with \`update_workspace_resources\` instead of creating a second workspace.
7. Reload. Call \`get_workspace_context\` again (or read the create result) so you hold the rulesets and coding guidelines before you write.

Only now write the infrastructure code, against those rulesets. Then commit, push, and run \`trigger_compliance_evaluation\`. Because the rules were in front of you the whole time, that first evaluation should mostly pass instead of becoming a fix-up round. If the repo comes back \`linked\`, you already have the rulesets and guidelines in the context and can proceed. If it comes back \`no_access\` or \`ambiguous\`, follow the \`message\` in the response before doing anything else.

TRIGGERING COMPLIANCE EVALUATIONS

\`trigger_compliance_evaluation\` runs against the code already pushed to the workspace's linked branch - it has no access to your local working tree. Before calling it, \`git add\`/\`git commit\`/\`git push\` everything to the remote branch you intend to evaluate. Skipping this silently evaluates whatever was last pushed, not the changes you just made - the tool will not warn you, and the returned score will look valid while being stale. Pass \`ref\` as the branch name you just pushed (e.g. \`main\`): that resolves the branch's current remote commit and records the branch on the run. Do NOT omit \`ref\` - omitting evaluates a cached snapshot of the workspace that can lag a fresh push - and do NOT pin a bare commit SHA - a SHA-scoped run records no branch and shows up as "branch unknown" in the product.

CONNECTING REPOSITORIES

Workspaces link to a repo through a version-control connection (GitHub, GitLab, ...). Discover them with \`list_vcs_connections\`, browse a connection's repos with \`list_vcs_repos\`, then pass connection_id + repo_path (the repo's full provider path, verbatim) when creating or linking. Always relay a \`warning\` in a link/create result: it means the delivery webhook failed to register and pushes will NOT trigger compliance until the repo is re-linked.`;

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
