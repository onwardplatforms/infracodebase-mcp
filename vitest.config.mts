/**
 * Vitest config — unit tests only.
 *
 * Tests are colocated next to the source they cover (`foo.test.ts` beside
 * `foo.ts`), matching the convention in the main application. There's no
 * integration project here: the MCP server has no database, and every tool is
 * exercised against a mocked InfracodebaseClient, so the whole suite runs
 * offline with no containers.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
