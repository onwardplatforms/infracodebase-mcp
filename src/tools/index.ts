/**
 * Tool registry — the single, self-documenting list of every MCP tool the
 * server exposes.
 *
 * Each tool lives in its own file (one `ToolDef` per file) and is imported
 * here. The `TOOLS` array below is the source of truth for what's registered:
 * to add a tool, create `src/tools/<name>.ts` and add its export to the list.
 * Shared plumbing (the API client, workspace→enterprise resolution, and the
 * registerTool wrapper) lives in `helpers.ts`; input schemas and descriptions
 * live in `validation.ts`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../server.js";
import { createToolContext, registerTool, type ToolDef } from "./helpers.js";

import { listEnterprises } from "./list_enterprises.js";
import { listWorkspaces } from "./list_workspaces.js";
import { getWorkspaceContext } from "./get_workspace_context.js";
import { getRulesetDetails } from "./get_ruleset_details.js";
import { getComplianceEvaluation } from "./get_compliance_evaluation.js";
import { listComplianceFindings } from "./list_compliance_findings.js";
import { getComplianceEvalSpec } from "./get_compliance_eval_spec.js";
import { listEnterpriseResources } from "./list_enterprise_resources.js";
import { listModules } from "./list_modules.js";
import { listGithubInstallations } from "./list_github_installations.js";
import { listGithubRepos } from "./list_github_repos.js";
import { createWorkspace } from "./create_workspace.js";
import { linkWorkspaceToRepo } from "./link_workspace_to_repo.js";
import { updateWorkspaceResources } from "./update_workspace_resources.js";

/** Every tool registered on the server, in registration order. */
export const TOOLS: ToolDef[] = [
  // Workspace
  listEnterprises,
  listWorkspaces,
  getWorkspaceContext,
  // Rulesets
  getRulesetDetails,
  // Compliance
  getComplianceEvaluation,
  listComplianceFindings,
  getComplianceEvalSpec,
  // Enterprise resources
  listEnterpriseResources,
  listModules,
  // GitHub
  listGithubInstallations,
  listGithubRepos,
  createWorkspace,
  linkWorkspaceToRepo,
  updateWorkspaceResources,
];

/** Register every tool in {@link TOOLS} on the server. */
export async function registerAllTools(server: McpServer, context: ServerContext): Promise<void> {
  const ctx = createToolContext(context);
  for (const tool of TOOLS) registerTool(server, tool, ctx);
}
