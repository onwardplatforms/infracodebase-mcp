/**
 * Single source of truth for the CLI/server version, read from package.json at
 * runtime so it can never drift from the published version. Resolved relative
 * to this module (dist/version.js -> ../package.json) so it works both from a
 * local build and from an installed/npx'd package.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");

function readVersion(): string {
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION: string = readVersion();
