import { expect, it, vi } from "vitest";
import { z } from "zod";
import { mockContext, mockClient } from "../test-helpers.js";
import { listWorkspaceModules } from "./list_workspace_modules.js";
import { listModuleConsumers } from "./list_module_consumers.js";
import { TOOL_SHAPES, TOOL_ANNOTATIONS } from "./validation.js";

it("passes inventory targets, filters and opaque cursors through without changing scan evidence", async () => {
  const evidence = {data: [{id: "reference", declared_version: "1.0.0"}], next_cursor: "next", scan: {incomplete: true, stale: true}};
  const client = mockClient({listWorkspaceModules: vi.fn().mockResolvedValue(evidence), listModuleConsumers: vi.fn().mockResolvedValue(evidence)});
  const ctx = mockContext({client});
  const query = {limit: 1, cursor: "opaque", status: "updates", query: "network.tf"};
  expect(await listWorkspaceModules.run(ctx, {workspace_id: "workspace", enterprise_id: "enterprise", ...query})).toBe(evidence);
  expect(ctx.getEnterpriseForWorkspace).toHaveBeenCalledWith("workspace", "enterprise");
  expect(client.listWorkspaceModules).toHaveBeenCalledWith("ent_default", "workspace", query);
  expect(await listModuleConsumers.run(ctx, {module_id: "module", ...query})).toBe(evidence);
  expect(client.listModuleConsumers).toHaveBeenCalledWith("ent_default", "module", query);
});

it("validates bounded read-only inventory inputs", () => {
  expect(z.object(TOOL_SHAPES.list_workspace_modules).safeParse({workspace_id: "w", limit: 101}).success).toBe(false);
  expect(z.object(TOOL_SHAPES.list_module_consumers).safeParse({module_id: "m", status: "updates"}).success).toBe(true);
  expect(TOOL_ANNOTATIONS.list_workspace_modules.readOnlyHint).toBe(true);
  expect(TOOL_ANNOTATIONS.list_module_consumers.destructiveHint).toBe(false);
});
