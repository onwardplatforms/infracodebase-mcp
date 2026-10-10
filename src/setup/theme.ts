/**
 * Theme-neutral colors for the interactive setup.
 *
 * Clack marks progress with green, blue, magenta, and cyan, which reads as
 * decoration rather than meaning and fights many terminal themes. This turns
 * those into the terminal's default text color on their way out, so the output
 * uses two tones every theme already balances: default text for what matters,
 * dim text for the rest. Red and yellow stay, as named colors the theme
 * renders in its own palette, because they mean something: failed, or needs
 * attention.
 */

const DEFAULT_FOREGROUND = "\u001b[39m";

/** Rewrite clack's decorative color codes to the terminal's default text color. */
export function neutralColors(text: string): string {
  return text.replace(/\u001b\[3[2456]m/g, DEFAULT_FOREGROUND);
}

/** Apply neutral colors to everything written to `stream` until the returned function is called. */
export function useNeutralColors(stream: NodeJS.WriteStream): () => void {
  if (!stream.isTTY) return () => undefined;

  const write = stream.write;
  stream.write = function (this: NodeJS.WriteStream, chunk: unknown, ...rest: unknown[]) {
    const recolored = typeof chunk === "string" ? neutralColors(chunk) : chunk;
    return (write as (...args: unknown[]) => boolean).call(this, recolored, ...rest);
  } as typeof stream.write;
  return () => {
    stream.write = write;
  };
}

/**
 * Whether the terminal turns OSC 8 escapes into clickable links. Terminals
 * that don't print the label and drop the target, so this only says yes for
 * ones known to support it.
 */
export function supportsHyperlinks(env: NodeJS.ProcessEnv): boolean {
  if (env.WT_SESSION || env.KITTY_WINDOW_ID) return true;
  return ["iTerm.app", "WezTerm", "vscode", "ghostty"].includes(env.TERM_PROGRAM ?? "");
}

/** A clickable `label` that opens `url`. */
export function hyperlink(label: string, url: string): string {
  return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}
