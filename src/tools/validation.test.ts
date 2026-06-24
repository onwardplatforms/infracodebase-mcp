import { describe, it, expect } from "vitest";
import { parseRepoUrl, TOOL_SHAPES, TOOL_DESCRIPTIONS } from "./validation.js";

describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/owner/name", { owner: "owner", name: "name" }],
    ["https://github.com/owner/name.git", { owner: "owner", name: "name" }],
    ["git@github.com:owner/name.git", { owner: "owner", name: "name" }],
    ["owner/name", { owner: "owner", name: "name" }],
    ["https://github.com/Owner/Name/", { owner: "owner", name: "name" }],
  ])("parses %s", (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected);
  });

  it("lowercases owner and name", () => {
    expect(parseRepoUrl("https://github.com/ACME/Infra")).toEqual({
      owner: "acme",
      name: "infra",
    });
  });

  it("returns null for input without an owner/name pair", () => {
    expect(parseRepoUrl("justname")).toBeNull();
    expect(parseRepoUrl("")).toBeNull();
  });
});

describe("tool metadata", () => {
  it("has a description for every shape (single source of truth stays in sync)", () => {
    const shapeNames = Object.keys(TOOL_SHAPES).sort();
    const descriptionNames = Object.keys(TOOL_DESCRIPTIONS).sort();
    expect(descriptionNames).toEqual(shapeNames);
  });
});
