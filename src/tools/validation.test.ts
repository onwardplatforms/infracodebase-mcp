import { describe, it, expect } from "vitest";
import {
  TOOL_SHAPES,
  TOOL_DESCRIPTIONS,
  TOOL_ANNOTATIONS,
  DESCRIPTION_BUDGET,
} from "./validation.js";

const names = Object.keys(TOOL_SHAPES).sort();

describe("tool metadata", () => {
  it("has a description and annotations for every shape (single source of truth stays in sync)", () => {
    expect(Object.keys(TOOL_DESCRIPTIONS).sort()).toEqual(names);
    expect(Object.keys(TOOL_ANNOTATIONS).sort()).toEqual(names);
  });

  it("keeps every description inside the budget clients display in full", () => {
    // Claude Code truncates tool descriptions at 2,048 characters. Guidance the
    // agent must act on belongs in the response payload, not past that point.
    for (const [name, description] of Object.entries(TOOL_DESCRIPTIONS)) {
      expect(description.length, `${name} description is too long`).toBeLessThanOrEqual(
        DESCRIPTION_BUDGET
      );
    }
  });

  it("marks read-only tools as non-destructive and gives every tool a title", () => {
    for (const [name, a] of Object.entries(TOOL_ANNOTATIONS)) {
      expect(a.title, `${name} needs a title`).toBeTruthy();
      expect(a.openWorldHint, `${name} talks to one known API`).toBe(false);
      if (a.readOnlyHint) expect(a.destructiveHint, `${name} is read-only`).toBe(false);
    }
    expect(TOOL_ANNOTATIONS.get_workspace_context.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.plan_workspace_setup.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.setup_workspace.readOnlyHint).toBe(false);
    expect(TOOL_ANNOTATIONS.update_workspace_resources.destructiveHint).toBe(true);
  });

  it("offers exactly the iac_tool values the API accepts (helm is rejected with HTTP 400)", () => {
    const options = TOOL_SHAPES.get_workspace_context.iac_tool.unwrap().options;
    expect(options).toContain("terraform");
    expect(options).toContain("kubernetes");
    expect(options).not.toContain("helm");
    expect(TOOL_SHAPES.setup_workspace.iac_tool.unwrap().options).toEqual(options);
  });
});
