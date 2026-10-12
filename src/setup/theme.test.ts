import { styleText } from "node:util";
import { describe, expect, it } from "vitest";
import { neutralColors, supportsHyperlinks } from "./theme.js";

// Build the exact codes clack emits, regardless of whether this test runs in a TTY.
const style = (format: Parameters<typeof styleText>[0], text: string) =>
  styleText(format, text, { validateStream: false });

describe("neutralColors", () => {
  it("turns clack's decorative colors into the default text color", () => {
    for (const color of ["green", "blue", "magenta", "cyan"] as const) {
      expect(neutralColors(style(color, "◆"))).toBe("\u001b[39m◆\u001b[39m");
    }
  });

  it("leaves red, yellow, dim, and gray for the terminal theme to render", () => {
    const text = `${style("red", "■")} ${style("yellow", "▲")} ${style("dim", "hint")} ${style("gray", "│")}`;
    expect(neutralColors(text)).toBe(text);
  });
});

describe("supportsHyperlinks", () => {
  it("says yes only for terminals known to make links clickable", () => {
    expect(supportsHyperlinks({ TERM_PROGRAM: "iTerm.app" })).toBe(true);
    expect(supportsHyperlinks({ WT_SESSION: "1" })).toBe(true);
    expect(supportsHyperlinks({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
    expect(supportsHyperlinks({})).toBe(false);
  });
});
