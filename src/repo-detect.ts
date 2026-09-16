import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ResolvedRepo {
  repo_url?: string;
  resolved_from: "argument" | "roots" | "cwd";
}
export interface RepoDetectDeps {
  listRoots(): Promise<string[]>;
  cwd(): string;
  gitRemote(dir: string): Promise<string | null>;
}

/** Missing repositories/remotes are normal; Git failures are not. */
export function gitRemoteUrl(dir: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", dir, "remote", "-v"], { timeout: 3000 }, (error, stdout, stderr) => {
      if (error) {
        if (stderr.includes("not a git repository")) return resolve(null);
        return reject(
          new Error(
            "Could not inspect this folder's Git remotes. Check Git and folder access, or pass repo_url explicitly."
          )
        );
      }
      const remotes = String(stdout)
        .split("\n")
        .map((line) => line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/))
        .filter(Boolean);
      const origin = remotes.find((r) => r![1] === "origin");
      const urls = [...new Set(remotes.map((r) => r![2]))];
      if (!origin && urls.length > 1)
        return reject(
          new Error(
            "Several Git remotes exist without origin. Pass repo_url to select the repository."
          )
        );
      resolve(origin?.[2] ?? urls[0] ?? null);
    });
  });
}

export function createRepoResolver(deps: RepoDetectDeps) {
  return async (explicit?: string): Promise<ResolvedRepo> => {
    if (explicit) {
      if (explicit.startsWith("/") || explicit.startsWith("file:"))
        throw new Error("repo_url must be a Git remote URL. Omit it to detect the current folder.");
      return { repo_url: explicit, resolved_from: "argument" };
    }
    const roots = await deps.listRoots();
    const dirs = roots.map((root) => (root.startsWith("file:") ? fileURLToPath(root) : root));
    // Advertised roots take precedence: never borrow the server checkout's
    // context when the client's actual project is an empty folder.
    if (dirs.length) {
      const urls = [
        ...new Set(
          (await Promise.all(dirs.map((dir) => deps.gitRemote(dir)))).filter(
            (url): url is string => url !== null
          )
        ),
      ];
      if (urls.length > 1)
        throw new Error(
          "Several repository roots are open. Pass repo_url to choose the project being edited."
        );
      return { repo_url: urls[0], resolved_from: "roots" };
    }
    return { repo_url: (await deps.gitRemote(deps.cwd())) ?? undefined, resolved_from: "cwd" };
  };
}
