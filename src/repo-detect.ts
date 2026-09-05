/**
 * Work out which repo the agent is in, so `get_workspace_context` and
 * `plan_workspace_setup` can be called with no arguments.
 *
 * Order: an explicit argument wins; then the client's MCP roots (the workspace
 * folders it advertises); then the server's own working directory, which stdio
 * clients such as Claude Code set to the project directory when they spawn the
 * server. Each candidate directory is asked for its git remote. The source is
 * reported back (`resolved_from`) so an auto-detected repo is never mistaken
 * for one the caller named.
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export type RepoSource = "argument" | "roots" | "cwd";

export interface ResolvedRepo {
  repo_url: string;
  resolved_from: RepoSource;
}

export interface RepoDetectDeps {
  /** file:// URIs (or absolute paths) the client advertises as workspace roots. */
  listRoots: () => Promise<string[]>;
  cwd: () => string;
  /** The remote URL for a directory, or null when it is not a repo or has no remote. */
  gitRemote: (dir: string) => Promise<string | null>;
}

const GIT_TIMEOUT_MS = 3000;

function git(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim() || null);
    });
  });
}

/** `origin` first; otherwise the first remote the repo has. */
export async function gitRemoteUrl(dir: string): Promise<string | null> {
  const origin = await git(["-C", dir, "remote", "get-url", "origin"]);
  if (origin) return origin;
  const remotes = await git(["-C", dir, "remote"]);
  const first = remotes
    ?.split("\n")
    .map((r) => r.trim())
    .find(Boolean);
  return first ? git(["-C", dir, "remote", "get-url", first]) : null;
}

function toPath(root: string): string | null {
  if (root.startsWith("file://")) {
    try {
      return fileURLToPath(root);
    } catch {
      return null;
    }
  }
  return root.startsWith("/") ? root : null;
}

export function createRepoResolver(deps: RepoDetectDeps) {
  return async function resolveRepoUrl(explicit?: string): Promise<ResolvedRepo> {
    if (explicit) return { repo_url: explicit, resolved_from: "argument" };

    let roots: string[] = [];
    try {
      roots = await deps.listRoots();
    } catch {
      roots = [];
    }
    const rootDirs = roots.map(toPath).filter((d): d is string => d !== null);
    for (const dir of rootDirs) {
      const url = await deps.gitRemote(dir);
      if (url) return { repo_url: url, resolved_from: "roots" };
    }

    const cwd = deps.cwd();
    const cwdUrl = await deps.gitRemote(cwd);
    if (cwdUrl) return { repo_url: cwdUrl, resolved_from: "cwd" };

    const checked = [...rootDirs, cwd].join(", ");
    throw new Error(
      `Could not detect a git remote (checked: ${checked}). ` +
        `Pass repo_url (the output of \`git remote get-url origin\`) or workspace_id.`
    );
  };
}
