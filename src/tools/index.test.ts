import { describe, it, expect } from "vitest";
import { TOOLS } from "./index.js";
import { TOOL_SHAPES } from "./validation.js";

describe("TOOLS registry", () => {
  it("registers exactly the tools declared in TOOL_SHAPES — no missing or extra", () => {
    const registered = TOOLS.map((t) => t.name).sort();
    const declared = Object.keys(TOOL_SHAPES).sort();
    expect(registered).toEqual(declared);
  });

  it("has no duplicate registrations", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
