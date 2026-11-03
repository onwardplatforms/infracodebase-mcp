import { describe, it, expect, vi } from "vitest";
import {
  createBranchResolver,
  createRepoResolver,
  parseRemoteRef,
  remoteMatchesRepo,
} from "./repo-detect.js";

function deps(overrides: Partial<Parameters<typeof createRepoResolver>[0]> = {}) {
  return {
    listRoots: vi.fn(async () => [] as string[]),
    cwd: vi.fn(() => "/work/project"),
    gitRemote: vi.fn(async (_dir: string) => null as string | null),
    ...overrides,
  };
}

describe("createRepoResolver", () => {
  it("returns an explicit repo_url untouched without probing anything", async () => {
    const d = deps();
    const resolve = createRepoResolver(d);

    expect(await resolve("git@github.com:acme/infra.git")).toEqual({
      repo_url: "git@github.com:acme/infra.git",
      resolved_from: "argument",
    });
    expect(d.listRoots).not.toHaveBeenCalled();
    expect(d.gitRemote).not.toHaveBeenCalled();
  });

  it("removes embedded HTTP credentials from explicit and detected remotes", async () => {
    const explicitDeps = deps();
    await expect(
      createRepoResolver(explicitDeps)("https://user:ghp_secret@github.com/acme/infra.git")
    ).resolves.toEqual({
      repo_url: "https://github.com/acme/infra.git",
      resolved_from: "argument",
    });

    const detectedDeps = deps({
      gitRemote: vi.fn(async () => "https://token:secret@gitlab.com/acme/infra.git"),
    });
    await expect(createRepoResolver(detectedDeps)()).resolves.toEqual({
      repo_url: "https://gitlab.com/acme/infra.git",
      resolved_from: "cwd",
    });
  });

  it("prefers a client root, converting its file:// URI to a path", async () => {
    const d = deps({
      listRoots: vi.fn(async () => ["file:///Users/ada/infra"]),
      gitRemote: vi.fn(async (dir) => (dir === "/Users/ada/infra" ? "https://github.com/acme/infra" : null)),
    });

    expect(await createRepoResolver(d)()).toEqual({
      repo_url: "https://github.com/acme/infra",
      resolved_from: "roots",
    });
    expect(d.cwd).not.toHaveBeenCalled();
  });

  it("falls back to the server's cwd when no root has a remote", async () => {
    const d = deps({
      listRoots: vi.fn(async () => ["file:///Users/ada/notes"]),
      gitRemote: vi.fn(async (dir) => (dir === "/work/project" ? "https://gitlab.com/g/sub/p.git" : null)),
    });

    expect(await createRepoResolver(d)()).toEqual({
      repo_url: "https://gitlab.com/g/sub/p.git",
      resolved_from: "cwd",
    });
  });

  it("treats a client that cannot list roots as having none", async () => {
    const d = deps({
      listRoots: vi.fn(async () => {
        throw new Error("Method not found");
      }),
      gitRemote: vi.fn(async () => "https://github.com/acme/infra"),
    });

    expect((await createRepoResolver(d)()).resolved_from).toBe("cwd");
  });

  it("ignores roots that are not local paths", async () => {
    const d = deps({ listRoots: vi.fn(async () => ["https://example.com/x", "not-a-path"]) });

    await expect(createRepoResolver(d)()).rejects.toThrow(/Could not detect a git remote/);
    expect(d.gitRemote).toHaveBeenCalledTimes(1);
    expect(d.gitRemote).toHaveBeenCalledWith("/work/project");
  });

  it("names every directory it checked when nothing has a remote", async () => {
    const d = deps({ listRoots: vi.fn(async () => ["file:///Users/ada/infra"]) });

    await expect(createRepoResolver(d)()).rejects.toThrow(
      "Could not detect a git remote (checked: /Users/ada/infra, /work/project). Pass repo_url"
    );
  });
});

describe("branch detection", () => {
  it("attaches the checked-out branch of the directory the remote came from", async () => {
    const d = deps({
      gitRemote: vi.fn(async () => "https://github.com/acme/infra"),
      gitBranch: vi.fn(async (dir) => (dir === "/work/project" ? "feature/x" : null)),
    });

    expect(await createRepoResolver(d)()).toEqual({
      repo_url: "https://github.com/acme/infra",
      resolved_from: "cwd",
      branch: "feature/x",
    });
  });

  it("omits the branch on a detached HEAD and never probes one for an explicit repo_url", async () => {
    const detached = deps({
      gitRemote: vi.fn(async () => "https://github.com/acme/infra"),
      gitBranch: vi.fn(async () => null),
    });
    expect(await createRepoResolver(detached)()).toEqual({
      repo_url: "https://github.com/acme/infra",
      resolved_from: "cwd",
    });

    const explicit = deps({ gitBranch: vi.fn(async () => "feature/x") });
    expect(await createRepoResolver(explicit)("acme/infra")).toEqual({
      repo_url: "acme/infra",
      resolved_from: "argument",
    });
    expect(explicit.gitBranch).not.toHaveBeenCalled();
  });

  it("resolves a branch alone: explicit wins, then a client root, then cwd, else null", async () => {
    const d = deps({
      listRoots: vi.fn(async () => ["file:///Users/ada/infra"]),
      gitBranch: vi.fn(async (dir) =>
        dir === "/Users/ada/infra" ? "feature/root" : dir === "/work/project" ? "feature/cwd" : null
      ),
    });
    const resolve = createBranchResolver(d);

    expect(await resolve("main")).toEqual({ branch: "main", resolved_from: "argument" });
    expect(await resolve()).toEqual({ branch: "feature/root", resolved_from: "roots" });

    const cwdOnly = createBranchResolver(deps({ gitBranch: vi.fn(async () => "feature/cwd") }));
    expect(await cwdOnly()).toEqual({ branch: "feature/cwd", resolved_from: "cwd" });

    const nothing = createBranchResolver(deps({ gitBranch: vi.fn(async () => null) }));
    expect(await nothing()).toEqual({ branch: null, reason: "no_checkout" });
    expect(await createBranchResolver(deps())()).toEqual({ branch: null, reason: "no_checkout" });
  });

  it("with a repo to match, ignores checkouts of other repos and says so", async () => {
    const d = deps({
      listRoots: vi.fn(async () => ["file:///Users/ada/other", "file:///Users/ada/infra"]),
      gitRemote: vi.fn(async (dir) =>
        dir === "/Users/ada/other"
          ? "git@github.com:acme/other.git"
          : dir === "/Users/ada/infra"
            ? "https://github.com/Acme/Infra"
            : null
      ),
      gitBranch: vi.fn(async (dir) =>
        dir === "/Users/ada/other" ? "feature/other" : dir === "/Users/ada/infra" ? "feature/infra" : null
      ),
    });
    const resolve = createBranchResolver(d);

    expect(await resolve(undefined, { repo: { owner: "acme", name: "infra" } })).toEqual({
      branch: "feature/infra",
      resolved_from: "roots",
    });
    expect(await resolve(undefined, { repo: { owner: "acme", name: "payments" } })).toEqual({
      branch: null,
      reason: "other_repo",
    });
    // Without a repo to match, the first checkout wins as before.
    expect(await resolve()).toEqual({ branch: "feature/other", resolved_from: "roots" });
  });

  it("parses remotes the way the platform stores them, keeping nested paths", () => {
    expect(parseRemoteRef("https://github.com/Acme/Infra.git")).toEqual({
      host: "github.com",
      owner: "Acme",
      name: "Infra",
      displayPath: "Acme/Infra",
    });
    expect(parseRemoteRef("git@gitlab.com:group/subgroup/project.git")).toEqual({
      host: "gitlab.com",
      owner: "group/subgroup",
      name: "project",
      displayPath: "group/subgroup/project",
    });
    expect(parseRemoteRef("https://acme@dev.azure.com/acme/Platform/_git/infra")).toEqual({
      host: "dev.azure.com",
      owner: "acme/Platform",
      name: "infra",
      displayPath: "acme/Platform/infra",
    });
    expect(parseRemoteRef("git@ssh.dev.azure.com:v3/acme/Platform/infra")).toMatchObject({
      host: "dev.azure.com",
      displayPath: "acme/Platform/infra",
    });
    expect(parseRemoteRef("ssh://git@ghe.acme.com:2222/owner/repo.git")).toMatchObject({
      host: "ghe.acme.com",
      displayPath: "owner/repo",
    });
    expect(parseRemoteRef("acme/infra")).toMatchObject({ host: "github.com", displayPath: "acme/infra" });
    expect(parseRemoteRef("not a remote")).toBeNull();
  });

  it("matches on the full display path when the server sends one, else on owner and name", () => {
    const nested = {
      owner: "group/subgroup",
      name: "project",
      host: "gitlab.com",
      display_path: "group/subgroup/project",
    };
    expect(remoteMatchesRepo("git@gitlab.com:group/subgroup/project.git", nested)).toBe(true);
    expect(remoteMatchesRepo("git@gitlab.com:other/subgroup/project.git", nested)).toBe(false);
    expect(remoteMatchesRepo("git@github.com:group/subgroup/project.git", nested)).toBe(false);
    expect(remoteMatchesRepo("git@github.com:acme/infra.git", { owner: "Acme", name: "Infra" })).toBe(true);
    expect(remoteMatchesRepo("git@github.com:acme/infra.git", { owner: "acme", name: "other" })).toBe(false);
    expect(remoteMatchesRepo("git@github.com:acme/infra.git", null)).toBe(false);
    expect(remoteMatchesRepo("git@github.com:acme/infra.git", { owner: "acme" })).toBe(false);
  });
});
