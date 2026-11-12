import type { CreatedVcsRepository } from "../client.js";
import type { ToolDef } from "./helpers.js";

/**
 * Apply a confirmed plan from `plan_workspace_setup` in one call: create the
 * workspace with its repo link and rulesets (or link an existing workspace and
 * attach rulesets), then reload the context so the agent can write against
 * the rules immediately. With `create_repo`, the repository itself is created
 * first, on the provider, as the user (their own connected account, never the
 * enterprise connection; the server refuses anything else and names the fix),
 * and the link uses the path and default branch the provider reports.
 *
 * Every argument is checked before the first side effect, and once a
 * repository exists no later failure may hide it: the result always carries
 * `repository` and a `next` that says to link it, not to create it again.
 * Link outcomes are surfaced explicitly: a failed link or a webhook warning
 * becomes the `status` and the `next` instruction, never an unqualified
 * success.
 */

interface CreateResult {
  workspace?: { id: string };
  repository_linked?: boolean | null;
  repository_error?: string;
  warning?: string;
}

/** A repository this call created, with the branch the link used. */
interface CreatedRepo {
  repository: CreatedVcsRepository;
  branch: string;
}

interface Outcome {
  workspace_id?: string;
  repository_linked: boolean;
  repository_error?: string;
  warning?: string;
  createdRepo?: CreatedRepo;
  created?: unknown;
  link?: unknown;
  attached?: unknown;
  context?: unknown;
}

/** How the user gets their local checkout onto the repository that was just created. */
function remoteInstructions({ repository, branch }: CreatedRepo) {
  return (
    `The repository was created at ${repository.web_url} with an initial commit on ${branch}. ` +
    `Tell the user to point this directory at it before writing: ` +
    `\`git remote add origin ${repository.clone_url}\` (or \`git remote set-url origin ` +
    `${repository.clone_url}\` if this checkout already has an origin), then ` +
    `\`git pull --rebase origin ${branch}\`, and \`git push -u origin ${branch}\` when there is work to push.`
  );
}

/** The retry for a repository that exists but is not linked: link it, never create it again. */
function linkInstead(connectionId: string, { repository, branch }: CreatedRepo) {
  return (
    `Do not pass create_repo again: the repository already exists. Call link_workspace_to_repo ` +
    `(or setup_workspace without create_repo) with connection_id ${connectionId}, repo_path ` +
    `"${repository.path}", and branch "${branch}".`
  );
}

function finish(connectionId: string, outcome: Outcome) {
  const { createdRepo, ...rest } = outcome;
  let status: string;
  let next: string;
  if (!outcome.repository_linked) {
    status = "workspace_ready_but_link_failed";
    next = createdRepo
      ? `The workspace exists but the repo link failed: ${outcome.repository_error ?? "see repository_error"}. ` +
        `Tell the user. ${linkInstead(connectionId, createdRepo)}`
      : `The workspace exists but the repo link failed: ${outcome.repository_error ?? "see repository_error"}. ` +
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
  if (createdRepo) next = `${remoteInstructions(createdRepo)} ${next}`;
  return { status, ...rest, repository: createdRepo?.repository, next };
}

/** Check every argument before anything is created. */
function validateArgs(a: Record<string, unknown>) {
  if (!a.workspace_name && !a.existing_workspace_id) {
    throw new Error(
      "Pass workspace_name to create a new workspace, or existing_workspace_id to link an existing one."
    );
  }
  if (a.create_repo) {
    if (!a.repo_name) {
      throw new Error("create_repo needs repo_name: the name of the repository to create.");
    }
    if (a.repo_path || a.branch) {
      throw new Error(
        "With create_repo, omit repo_path and branch: the created repository decides both. To link " +
          "a repository that already exists, drop create_repo and pass repo_path and branch."
      );
    }
    return;
  }
  if (a.repo_name || a.visibility || a.repo_description) {
    throw new Error(
      "repo_name, visibility, and repo_description only apply with create_repo. To create the " +
        "repository first, pass create_repo true; to link an existing one, drop them."
    );
  }
  if (!a.repo_path || !a.branch) {
    throw new Error(
      "Pass repo_path and branch from the plan to link an existing repository, or create_repo with " +
        "repo_name to create one first."
    );
  }
}

export const setupWorkspace: ToolDef = {
  name: "setup_workspace",
  async run(ctx, a) {
    const { client } = ctx;
    validateArgs(a);

    let createdRepo: CreatedRepo | undefined;
    if (a.create_repo) {
      const repository = await client.createVcsRepository(a.enterprise_id, a.connection_id, {
        name: a.repo_name,
        description: a.repo_description,
        visibility: a.visibility,
      });
      createdRepo = { repository, branch: repository.default_branch || "main" };
    }
    const link = {
      connection_id: a.connection_id as string,
      path: createdRepo ? createdRepo.repository.path : (a.repo_path as string),
      branch: createdRepo ? createdRepo.branch : (a.branch as string),
    };

    try {
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
        return finish(link.connection_id, {
          workspace_id: workspaceId,
          repository_linked: true,
          warning: linked.warning,
          createdRepo,
          link: linked,
          attached,
          context,
        });
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
      return finish(link.connection_id, {
        workspace_id: workspaceId,
        repository_linked: created.repository_linked === true,
        repository_error: created.repository_error,
        warning: created.warning,
        createdRepo,
        created,
        context,
      });
    } catch (err) {
      // A thrown error would lose the repository that was just created, and
      // the natural retry (create_repo again) would then fail on the provider
      // with "name already exists". Answer with the repository and the link
      // retry instead.
      if (!createdRepo) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "repository_created_but_setup_failed",
        repository: createdRepo.repository,
        error: message,
        next:
          `${remoteInstructions(createdRepo)} The repository exists but the workspace step failed: ` +
          `${message} Tell the user. ${linkInstead(link.connection_id, createdRepo)}`,
      };
    }
  },
};
