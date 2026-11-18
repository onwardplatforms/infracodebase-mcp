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
 *
 * The same roots-then-cwd order also yields the checked-out branch
 * (`createBranchResolver`), optionally only from a checkout whose remote is a
 * given workspace's repo, and tools report it as `resolved_branch` or say why
 * none was used, so a default-branch answer is never silent.
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export type RepoSource = "argument" | "roots" | "cwd";

export interface ResolvedRepo {
  repo_url: string;
  resolved_from: RepoSource;
  /** The checked-out branch of the directory the remote was read from. Absent for an explicit repo_url or a detached HEAD. */
  branch?: string;
}

export interface ResolvedBranch {
  branch: string;
  resolved_from: RepoSource;
}

/**
 * Why no branch was used. `no_checkout`: no root or cwd is a git checkout
 * with a readable branch (also covers git missing or timing out, which the
 * stderr log distinguishes). `other_repo`: a checkout was found but its remote
 * is not the workspace's repo, so its branch would be the wrong one.
 * `repo_unknown`: the workspace's repo is not known (none on record, the
 * workspace was not found, or the lookup failed), so no checkout could be
 * matched and none was trusted. `unparsed_repo_url`: the caller's repo_url is
 * not a git remote this server can parse, so there was nothing to match on.
 */
export type NoBranchReason = "no_checkout" | "other_repo" | "repo_unknown" | "unparsed_repo_url";

export type BranchDetection =
  | ResolvedBranch
  | {
      branch: null;
      reason: NoBranchReason;
      /** What went wrong, for the agent-facing note, when the reason alone does not say. */
      detail?: string;
    };

export interface RepoDetectDeps {
  /** file:// URIs (or absolute paths) the client advertises as workspace roots. */
  listRoots: () => Promise<string[]>;
  cwd: () => string;
  /** The remote URL for a directory, or null when it is not a repo or has no remote. */
  gitRemote: (dir: string) => Promise<string | null>;
  /** The checked-out branch of a directory, or null for a detached HEAD or a non-repo. */
  gitBranch?: (dir: string) => Promise<string | null>;
}

const GIT_TIMEOUT_MS = 3000;

/**
 * Detection could not run at all: git is not installed, it timed out, or it
 * refused the directory (dubious ownership in a container or a shared
 * checkout). Distinct from "ran and found nothing", because the two call for
 * opposite answers: the former needs a repo_url from the user, the latter
 * means a repository has to be created.
 */
export class RepoDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoDetectionError";
  }
}

/** Git ran everywhere it was asked and none of those directories has a remote. */
export class NoRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoRemoteError";
  }
}

/** The result of one git command: its trimmed stdout, or why it gave none. */
interface GitResult {
  out: string | null;
  /** Set when git did not get to answer, as opposed to answering "no". */
  failure?: string;
}

function run(args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile("git", args, { timeout: GIT_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        // A non-zero exit is an ordinary "no" (not a repo, no upstream). A
        // spawn failure, a timeout, or git refusing the directory is not, so
        // say so rather than letting it read as a detached HEAD or a missing
        // remote.
        const refused = /dubious ownership/i.test(String(stderr));
        const spawnFailure = (err as NodeJS.ErrnoException).code === "ENOENT" || err.killed;
        if (spawnFailure || refused) {
          const detail = refused ? String(stderr).trim() : err.message;
          console.error(`[infracodebase-mcp] git ${args.slice(2).join(" ")} failed: ${detail}`);
          resolve({ out: null, failure: detail });
          return;
        }
        resolve({ out: null });
        return;
      }
      resolve({ out: String(stdout).trim() || null });
    });
  });
}

/** Stdout of a git command, or null for any kind of "no". Branch detection
 *  degrades on a failure (no branch is a safe answer there). */
async function git(args: string[]): Promise<string | null> {
  return (await run(args)).out;
}

/** Like `git`, but a failure to run is thrown as a RepoDetectionError. Remote
 *  detection must not degrade: a missing remote means "create a repository",
 *  which is the wrong answer when git simply could not look. */
async function gitStrict(args: string[]): Promise<string | null> {
  const result = await run(args);
  if (result.failure !== undefined) {
    throw new RepoDetectionError(
      `Could not run git to detect the repository (${result.failure}). Pass repo_url (the output ` +
        "of `git remote get-url origin`) or workspace_id."
    );
  }
  return result.out;
}

/** The remote a checkout is identified by: `origin` when it has one, else the first `git remote` lists (alphabetical). */
function pickRemote(remotes: string[]): string | null {
  return remotes.includes("origin") ? "origin" : (remotes[0] ?? null);
}

/** The repo's remotes; null when `git remote` itself failed, which is not the same as having none. */
async function listRemotes(dir: string): Promise<string[] | null> {
  const out = await gitStrict(["-C", dir, "remote"]);
  return out === null ? null : out.split("\n").map((r) => r.trim()).filter(Boolean);
}

/** The URL of the remote `pickRemote` chooses: `origin` first, else the first
 *  `git remote` lists. Throws RepoDetectionError when git could not look. */
export async function gitRemoteUrl(dir: string): Promise<string | null> {
  const origin = await gitStrict(["-C", dir, "remote", "get-url", "origin"]);
  if (origin) return origin;
  const first = pickRemote((await listRemotes(dir)) ?? []);
  return first ? gitStrict(["-C", dir, "remote", "get-url", first]) : null;
}

/** A repo identity as the platform stores it: full provider path, split into owner and name. */
export interface RemoteRef {
  host: string;
  owner: string;
  name: string;
  displayPath: string;
}

/**
 * Parse a git remote the way the platform does (a port of the app's
 * parseRemoteRef): the path keeps every segment, so GitLab subgroups survive,
 * and Azure DevOps' `_git` and `v3/` markers are dropped so the result matches
 * the stored display path. Handles ssh scp-style, https (with userinfo), and
 * bare `owner/repo` shorthand. Null when the input is not a remote.
 */
export function parseRemoteRef(input: string): RemoteRef | null {
  const trimmed = input.trim().replace(/\.git$/, "");
  const split = (rawHost: string, rawPath: string): RemoteRef | null => {
    const host = (rawHost === "ssh.dev.azure.com" ? "dev.azure.com" : rawHost).toLowerCase();
    const clean = rawPath
      .replace(/\/+$/, "")
      .replace(/^v3\//, "")
      .replace(/\/_git\//, "/");
    const slash = clean.lastIndexOf("/");
    if (slash <= 0 || slash === clean.length - 1) return null;
    return { host, owner: clean.slice(0, slash), name: clean.slice(slash + 1), displayPath: clean };
  };
  const sshUrl = trimmed.match(/^ssh:\/\/(?:[^@/\s]+@)?([^\s/:]+)(?::\d+)?\/([^?#\s]+)/);
  if (sshUrl) return split(sshUrl[1], sshUrl[2]);
  const ssh = trimmed.match(/^[^\s@]+@([^\s@:/]+):(.+)$/);
  if (ssh) return split(ssh[1], ssh[2]);
  const https = trimmed.match(/^https?:\/\/(?:[^@/\s]+@)?(?:www\.)?([^\s/?#@]+)\/([^?#\s]+)/);
  if (https) return split(https[1], https[2]);
  const short = trimmed.match(/^([^/\s@:]+)\/([^/\s@:]+)$/);
  if (short) return split("github.com", `${short[1]}/${short[2]}`);
  return null;
}

/** What the API tells us about a workspace's linked repo. Older servers send only owner and name. */
export interface LinkedRepo {
  owner?: string | null;
  name?: string | null;
  host?: string | null;
  display_path?: string | null;
}

/**
 * True when a checkout's remote is the workspace's repo. Compares the full
 * display path when the server sends one (so nested GitLab groups and Azure
 * DevOps projects match), and the host when both sides know it; falls back to
 * owner and name for servers that send nothing more.
 */
export function remoteMatchesRepo(remote: string, repo: LinkedRepo | null | undefined): boolean {
  const parsed = parseRemoteRef(remote);
  if (!parsed || !repo) return false;
  const lower = (v: string | null | undefined) => (v ?? "").toLowerCase();
  if (repo.display_path) {
    if (lower(repo.display_path) !== parsed.displayPath.toLowerCase()) return false;
    return !repo.host || lower(repo.host) === parsed.host;
  }
  if (!repo.owner || !repo.name) return false;
  return lower(repo.owner) === parsed.owner.toLowerCase() && lower(repo.name) === parsed.name.toLowerCase();
}

/**
 * The branch the server will know this checkout as: the upstream branch name
 * when one is set on the remote `gitRemoteUrl` reads (a local `feature`
 * tracking `origin/jo/feature` is `jo/feature` to the platform), else the
 * local name. An upstream on another remote (a fork) names a branch of a
 * different repo, so it is ignored. Null on a detached HEAD or outside a repo.
 */
export async function gitBranchName(dir: string): Promise<string | null> {
  const upstream = await git([
    "-C",
    dir,
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (upstream && upstream !== "@{u}") {
    const slash = upstream.indexOf("/");
    if (slash > 0) {
      const remote = upstream.slice(0, slash);
      // `origin` is always the remote gitRemoteUrl reads when it exists, so
      // only another remote needs the list to check it is the one in use.
      if (remote === "origin") return upstream.slice(slash + 1);
      const remotes = await listRemotes(dir);
      // A branch with an upstream has at least one remote, so a failed list
      // is a failure, not "no remotes". Do not guess a branch name from it.
      if (remotes === null) return null;
      if (pickRemote(remotes) === remote) return upstream.slice(slash + 1);
    }
  }
  const name = await git(["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
  return name && name !== "HEAD" ? name : null;
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

/** Remove HTTP(S) userinfo before a remote URL leaves the local machine. */
export function sanitizeRepoUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    // SCP-style SSH remotes (git@host:owner/repo.git) are not WHATWG URLs and
    // contain an account name, not an HTTP credential.
    return value;
  }
}

/** The client's roots as local directories. A failed roots/list counts as no roots. */
async function listRootDirs(
  deps: RepoDetectDeps,
  onError?: (err: unknown) => void
): Promise<string[]> {
  let roots: string[] = [];
  try {
    roots = await deps.listRoots();
  } catch (err) {
    onError?.(err);
  }
  return roots.map(toPath).filter((d): d is string => d !== null);
}

export function createRepoResolver(deps: RepoDetectDeps) {
  return async function resolveRepoUrl(explicit?: string): Promise<ResolvedRepo> {
    if (explicit) return { repo_url: sanitizeRepoUrl(explicit), resolved_from: "argument" };

    const rootDirs = await listRootDirs(deps);
    const withBranch = async (dir: string, repo: ResolvedRepo): Promise<ResolvedRepo> => {
      const branch = deps.gitBranch ? await deps.gitBranch(dir) : null;
      return branch ? { ...repo, branch } : repo;
    };
    for (const dir of rootDirs) {
      const url = await deps.gitRemote(dir);
      if (url) return withBranch(dir, { repo_url: sanitizeRepoUrl(url), resolved_from: "roots" });
    }

    const cwd = deps.cwd();
    const cwdUrl = await deps.gitRemote(cwd);
    if (cwdUrl) return withBranch(cwd, { repo_url: sanitizeRepoUrl(cwdUrl), resolved_from: "cwd" });

    const checked = [...rootDirs, cwd].join(", ");
    throw new NoRemoteError(
      `Could not detect a git remote (checked: ${checked}). ` +
        `Pass repo_url (the output of \`git remote get-url origin\`) or workspace_id.`
    );
  };
}

/**
 * The branch the agent is working on, for tools that already know the
 * workspace. An explicit argument wins. Otherwise the first client root, then
 * the server's working directory, that is a git checkout with a branch. With
 * `options`, only a checkout whose remote is `options.repo` counts, so a
 * workspace is never asked about another project's branch; a null repo there
 * means the repo is not known, and then no checkout is trusted at all
 * (`repo_unknown`). Without `options` the first checkout wins. The result
 * says why no branch was used, so callers can report the fallback.
 */
export function createBranchResolver(deps: RepoDetectDeps) {
  return async function resolveBranch(
    explicit?: string,
    options?: { repo: LinkedRepo | null }
  ): Promise<BranchDetection> {
    if (explicit) return { branch: explicit, resolved_from: "argument" };
    if (!deps.gitBranch) return { branch: null, reason: "no_checkout" };
    // A caller that meant to match a repo but has none to match must not be
    // handed the first checkout's branch: it could belong to any project.
    if (options && !options.repo) return { branch: null, reason: "repo_unknown" };

    const rootDirs = await listRootDirs(deps, (err) =>
      console.error(
        `[infracodebase-mcp] roots/list failed; using the working directory: ${String(err)}`
      )
    );
    const candidates: Array<{ dir: string; source: RepoSource }> = [
      ...rootDirs.map((dir) => ({ dir, source: "roots" as const })),
      { dir: deps.cwd(), source: "cwd" as const },
    ];
    let sawOtherRepo = false;
    for (const { dir, source } of candidates) {
      if (options) {
        const remote = await deps.gitRemote(dir);
        if (!remote) continue;
        if (!remoteMatchesRepo(remote, options.repo)) {
          sawOtherRepo = true;
          continue;
        }
      }
      const branch = await deps.gitBranch(dir);
      if (branch) return { branch, resolved_from: source };
    }
    return { branch: null, reason: sawOtherRepo ? "other_repo" : "no_checkout" };
  };
}
