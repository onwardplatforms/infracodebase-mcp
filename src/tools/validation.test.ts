import { describe, it, expect } from "vitest";
import { TOOL_SHAPES, TOOL_DESCRIPTIONS } from "./validation.js";

describe("tool metadata", () => {
  it("has a description for every shape (single source of truth stays in sync)", () => {
    const shapeNames = Object.keys(TOOL_SHAPES).sort();
    const descriptionNames = Object.keys(TOOL_DESCRIPTIONS).sort();
    expect(descriptionNames).toEqual(shapeNames);
  });
});
