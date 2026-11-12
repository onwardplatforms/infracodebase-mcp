import type { CreatedVcsRepository } from "../client.js";
import type { ToolDef } from "./helpers.js";

/**
 * Apply a confirmed plan from `plan_workspace_setup` in one call: create the
 * workspace with its repo link and rulesets (or link an existing workspace and
 * attach rulesets), then reload the context so the agent can write against
 * the rules immediately. With `create_repo`, the repository itself is created
 * first, on the provider, as the user (their own connected account, never the
 * enterprise connection; the server refuses providers without that flow), and
 * the link uses the path and default branch the provider reports. Link
 * outcomes are surfaced explicitly: a failed link or a webhook warning becomes
 * the `status` and the `next` instruction, never an unqualified success.
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
  repository?: CreatedVcsRepository;
  created?: unknown;
  link?: unknown;
  attached?: unknown;
  context?: unknown;
}

/** How the user gets their local checkout onto the repository that was just created. */
function remoteInstructions(repository: CreatedVcsRepository, branch: string) {
  return (
    `The repository was created at ${repository.web_url} with an initial commit on ${branch}. ` +
    `Tell the user to point this directory at it before writing: ` +
    `\`git remote add origin ${repository.clone_url} && git pull --rebase origin ${branch}\` ` +
    `(then \`git push -u origin ${branch}\` when there is work to push).`
  );
}

function finish(outcome: Outcome, branch: string) {
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
  if (outcome.repository) next = `${remoteInstructions(outcome.repository, branch)} ${next}`;
  return { status, ...outcome, next };
}

export const setupWorkspace: ToolDef = {
  name: "setup_workspace",
  async run(ctx, a) {
    const { client } = ctx;

    // With create_repo the repository decides its own path and default
    // branch; without it both must come from the plan.
    let repository: CreatedVcsRepository | undefined;
    let repoPath: string | undefined = a.repo_path;
    let branch: string | undefined = a.branch;
    if (a.create_repo) {
      if (!a.repo_name) {
        throw new Error("create_repo needs repo_name: the name of the repository to create.");
      }
      repository = await client.createVcsRepository(a.enterprise_id, a.connection_id, {
        name: a.repo_name,
        description: a.repo_description,
        visibility: a.visibility,
      });
      repoPath = repository.path;
      branch = repository.default_branch || "main";
    } else if (!repoPath || !branch) {
      throw new Error(
        "Pass repo_path and branch from the plan to link an existing repository, or create_repo with " +
          "repo_name to create one first."
      );
    }
    const link = { connection_id: a.connection_id, path: repoPath, branch };

    if (a.existing_workspace_id) {
      const workspaceId: string = a.existing_workspace_id;
      const linked = (await client.linkWorkspaceToRepo(a.enterprise_id, workspaceId, link)) as {
        warning?: string;
      };
      ctx.forgetWorkspaceRepo(workspaceId);
      const attached = a.ruleset_ids?.length
        ? await client.updateWorkspaceResources(a.enterprise_id, workspaceId, {
            add_ruleset_ids: a.ruleset_ids,
          })
        : undefined;
      const context = await client.resolveWorkspaceContext({ workspaceId, iacTool: a.iac_tool });
      return finish(
        {
          workspace_id: workspaceId,
          repository_linked: true,
          warning: linked.warning,
          repository,
          link: linked,
          attached,
          context,
        },
        branch
      );
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
      repository: link,
    })) as CreateResult;
    const workspaceId = created.workspace?.id;
    const context = workspaceId
      ? await client.resolveWorkspaceContext({ workspaceId, iacTool: a.iac_tool })
      : undefined;
    return finish(
      {
        workspace_id: workspaceId,
        repository_linked: created.repository_linked === true,
        repository_error: created.repository_error,
        warning: created.warning,
        repository,
        created,
        context,
      },
      branch
    );
  },
};
