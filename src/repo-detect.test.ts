import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRepoResolver, gitRemoteUrl } from "./repo-detect.js";

describe("repository detection", () => {
  it("never borrows server cwd context when the client root is empty", async () => {
    const remote = vi.fn(async (dir: string) =>
      dir === "/server" ? "https://github.com/wrong/repo" : null
    );
    expect(
      await createRepoResolver({
        listRoots: async () => ["file:///project"],
        cwd: () => "/server",
        gitRemote: remote,
      })()
    ).toEqual({ repo_url: undefined, resolved_from: "roots" });
    expect(remote).toHaveBeenCalledExactlyOnceWith("/project");
  });
  it("requires selection for multiple client repositories", async () => {
    const resolve = createRepoResolver({
      listRoots: async () => ["file:///one", "file:///two"],
      cwd: () => "/server",
      gitRemote: async (dir) => `https://example.com${dir}`,
    });
    await expect(resolve()).rejects.toThrow("Several repository roots");
    expect(await resolve("https://example.com/explicit")).toMatchObject({
      repo_url: "https://example.com/explicit",
      resolved_from: "argument",
    });
  });
  it("surfaces roots failures rather than consulting an unrelated cwd", async () => {
    await expect(
      createRepoResolver({
        listRoots: async () => {
          throw new Error("Roots unavailable");
        },
        cwd: () => "/server",
        gitRemote: vi.fn(),
      })()
    ).rejects.toThrow("Roots unavailable");
  });
  it("distinguishes no repo, no remote, origin, and ambiguous remotes using Git", async () => {
    const dir = await mkdtemp(join(tmpdir(), "icb-git-test-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    try {
      expect(await gitRemoteUrl(dir)).toBeNull();
      git("init");
      expect(await gitRemoteUrl(dir)).toBeNull();
      git("remote", "add", "other", "https://gitlab.com/org/one");
      expect(await gitRemoteUrl(dir)).toBe("https://gitlab.com/org/one");
      git("remote", "add", "second", "https://gitlab.com/org/two");
      await expect(gitRemoteUrl(dir)).rejects.toThrow("Several Git remotes");
      git("remote", "add", "origin", "https://dev.azure.com/org/project/_git/repo");
      expect(await gitRemoteUrl(dir)).toBe("https://dev.azure.com/org/project/_git/repo");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
