/**
 * Infracodebase colors for the interactive setup.
 *
 * Clack styles everything with named ANSI colors, which each terminal theme
 * renders differently. This swaps those codes for the app's own colors
 * (app/globals.css in the main repository) on their way to the terminal: exact
 * values where the terminal supports 24-bit color, the nearest 256-color match
 * otherwise. The app's primary is plain black or white, so clack's cyan accent
 * and magenta spinner become the terminal's default text color.
 */

type Rgb = [number, number, number];

const BRAND: Record<"success" | "destructive" | "warning", { rgb: Rgb; ansi256: number }> = {
  success: { rgb: [0x34, 0xc7, 0x59], ansi256: 77 }, // #34C759
  destructive: { rgb: [0xff, 0x38, 0x3c], ansi256: 203 }, // #FF383C
  warning: { rgb: [0xff, 0xcc, 0x00], ansi256: 220 }, // #FFCC00
};

const DEFAULT_FOREGROUND = "\u001b[39m";

function foreground(color: (typeof BRAND)[keyof typeof BRAND], depth: number): string {
  return depth >= 24
    ? `\u001b[38;2;${color.rgb.join(";")}m`
    : `\u001b[38;5;${color.ansi256}m`;
}

/**
 * Rewrite named-color codes to brand colors for a terminal of the given color
 * depth (bits, as reported by `tty.WriteStream#getColorDepth`). Terminals with
 * 16 colors or fewer keep the named colors, which are the best they can show.
 */
export function brandColors(text: string, depth: number): string {
  if (depth < 8) return text;
  const replacements: Record<string, string> = {
    "\u001b[32m": foreground(BRAND.success, depth),
    "\u001b[31m": foreground(BRAND.destructive, depth),
    "\u001b[33m": foreground(BRAND.warning, depth),
    "\u001b[35m": DEFAULT_FOREGROUND,
    "\u001b[36m": DEFAULT_FOREGROUND,
  };
  return text.replace(/\u001b\[3[12356]m/g, (code) => replacements[code] ?? code);
}

/** Apply brand colors to everything written to `stream` until the returned function is called. */
export function useBrandColors(stream: NodeJS.WriteStream): () => void {
  if (!stream.isTTY) return () => undefined;
  const depth = stream.getColorDepth();
  if (depth < 8) return () => undefined;

  const write = stream.write;
  stream.write = function (this: NodeJS.WriteStream, chunk: unknown, ...rest: unknown[]) {
    const recolored = typeof chunk === "string" ? brandColors(chunk, depth) : chunk;
    return (write as (...args: unknown[]) => boolean).call(this, recolored, ...rest);
  } as typeof stream.write;
  return () => {
    stream.write = write;
  };
}
