/**
 * Shared test scaffolding for the tool unit tests.
 *
 * Tools receive a `ToolContext` (the API client plus the workspace→enterprise
 * resolution helpers and the repo auto-detector). In tests we hand them a
 * fully mocked context so each `ToolDef.run` can be exercised offline,
 * asserting which client method it calls and with what arguments.
 *
 * Excluded from the published build via tsconfig — this file never ships.
 */

import { vi } from "vitest";
import type { InfracodebaseClient } from "./client.js";
import type { ResolvedRepo } from "./repo-detect.js";
import type { ToolContext, WorkspaceEntry } from "./tools/helpers.js";

/**
 * A client where every method is a vi.fn(). Pass `methods` to stub the ones a
 * given tool calls; the rest are present but unstubbed so accidental calls are
 * easy to spot.
 */
export function mockClient(methods: Partial<Record<keyof InfracodebaseClient, unknown>> = {}) {
  return new Proxy(methods as Record<string, unknown>, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn();
      return target[prop];
    },
  }) as unknown as InfracodebaseClient & Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * Build a ToolContext with vi.fn() helpers, overridable per test. The default
 * repo resolver honours an explicit argument and otherwise fails the way the
 * real one does when no git remote is found, so tests that rely on
 * auto-detection have to say so.
 */
export function mockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    client: mockClient(),
    listAllWorkspaces: vi.fn(async () => [] as WorkspaceEntry[]),
    getEnterpriseForWorkspace: vi.fn(async () => "ent_default"),
    resolveRepoUrl: vi.fn(async (explicit?: string): Promise<ResolvedRepo> => {
      if (explicit) return { repo_url: explicit, resolved_from: "argument" };
      throw new Error("Could not detect a git remote (checked: /mock). Pass repo_url or workspace_id.");
    }),
    ...overrides,
  };
}
