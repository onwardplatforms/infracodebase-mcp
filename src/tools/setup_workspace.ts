import type { ToolDef } from "./helpers.js";

/**
 * Apply a confirmed plan from `plan_workspace_setup` in one call: create the
 * workspace with its repo link and rulesets (or link an existing workspace and
 * attach rulesets), then reload the context so the agent can write against
 * the rules immediately. Link outcomes are surfaced explicitly: a failed link
 * or a webhook warning becomes the `status` and the `next` instruction, never
 * an unqualified success.
 */

interface CreateResult {
  workspace?: { id: string };
  repository_linked?: boolean | null;
  repository_error?: string;
  warning?: string;
}

interface Outcome {
  workspace_id?: string;
  repository_linked: boolean;
  repository_error?: string;
  warning?: string;
  created?: unknown;
  link?: unknown;
  attached?: unknown;
  context?: unknown;
}

function finish(outcome: Outcome) {
  let status: string;
  let next: string;
  if (!outcome.repository_linked) {
    status = "workspace_ready_but_link_failed";
    next =
      `The workspace exists but the repo link failed: ${outcome.repository_error ?? "see repository_error"}. ` +
      "Tell the user. Fix the cause (usually the branch does not exist on the remote yet: push an initial " +
      "commit), then call link_workspace_to_repo with the same connection_id, repo_path, and branch.";
  } else if (outcome.warning) {
    status = "linked_with_warning";
    next =
      "Tell the user: the repo is linked, but its delivery webhook did not register, so pushes will NOT " +
      `trigger compliance until the repo is re-linked (${outcome.warning}). Then write IaC against ` +
      "context.rulesets and context.coding_guidelines.";
  } else {
    status = "linked";
    next =
      "Setup complete. Write IaC against context.rulesets and context.coding_guidelines. When done, commit, " +
      "push to the linked branch, and call trigger_compliance_evaluation with ref set to that branch.";
  }
  return { status, ...outcome, next };
}

export const setupWorkspace: ToolDef = {
  name: "setup_workspace",
  async run({ client }, a) {
    const repository = { connection_id: a.connection_id, path: a.repo_path, branch: a.branch };

    if (a.existing_workspace_id) {
      const workspaceId: string = a.existing_workspace_id;
      const link = (await client.linkWorkspaceToRepo(a.enterprise_id, workspaceId, repository)) as {
        warning?: string;
      };
      const attached = a.ruleset_ids?.length
        ? await client.updateWorkspaceResources(a.enterprise_id, workspaceId, {
            add_ruleset_ids: a.ruleset_ids,
          })
        : undefined;
      const context = await client.resolveWorkspaceContext({ workspaceId, iacTool: a.iac_tool });
      return finish({
        workspace_id: workspaceId,
        repository_linked: true,
        warning: link.warning,
        link,
        attached,
        context,
      });
    }

    if (!a.workspace_name) {
      throw new Error(
        "Pass workspace_name to create a new workspace, or existing_workspace_id to link an existing one."
      );
    }

    const created = (await client.createWorkspace(a.enterprise_id, {
      name: a.workspace_name,
      description: a.description,
      ruleset_ids: a.ruleset_ids,
      repository,
    })) as CreateResult;
    const workspaceId = created.workspace?.id;
    const context = workspaceId
      ? await client.resolveWorkspaceContext({ workspaceId, iacTool: a.iac_tool })
      : undefined;
    return finish({
      workspace_id: workspaceId,
      repository_linked: created.repository_linked === true,
      repository_error: created.repository_error,
      warning: created.warning,
      created,
      context,
    });
  },
};
