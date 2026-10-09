import { styleText } from "node:util";
import { describe, expect, it } from "vitest";
import { brandColors } from "./theme.js";

// Build the exact codes clack emits, regardless of whether this test runs in a TTY.
const style = (format: Parameters<typeof styleText>[0], text: string) =>
  styleText(format, text, { validateStream: false });

describe("brandColors", () => {
  it("uses the app's exact success, error, and warning colors on 24-bit terminals", () => {
    expect(brandColors(style("green", "◆"), 24)).toBe("\u001b[38;2;52;199;89m◆\u001b[39m");
    expect(brandColors(style("red", "■"), 24)).toBe("\u001b[38;2;255;56;60m■\u001b[39m");
    expect(brandColors(style("yellow", "▲"), 24)).toBe("\u001b[38;2;255;204;0m▲\u001b[39m");
  });

  it("falls back to the nearest 256-color match", () => {
    expect(brandColors(style("green", "◆"), 8)).toBe("\u001b[38;5;77m◆\u001b[39m");
  });

  it("replaces clack's cyan accent and magenta spinner with the default text color", () => {
    expect(brandColors(style("cyan", "◻"), 24)).toBe("\u001b[39m◻\u001b[39m");
    expect(brandColors(style("magenta", "◒"), 24)).toBe("\u001b[39m◒\u001b[39m");
  });

  it("leaves dim and gray text, and 16-color terminals, untouched", () => {
    const text = `${style("dim", "hint")} ${style("gray", "│")}`;
    expect(brandColors(text, 24)).toBe(text);
    expect(brandColors(style("green", "◆"), 4)).toBe(style("green", "◆"));
  });
});
