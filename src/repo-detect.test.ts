import { describe, it, expect, vi } from "vitest";
import { createRepoResolver } from "./repo-detect.js";

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
