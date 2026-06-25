/**
 * Minimal ANSI styling for human-facing CLI output. Colors are emitted only
 * when stdout is a TTY and NO_COLOR is unset, so piped/redirected output (and
 * captured logs) stay plain text.
 */
const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const wrap = (open: number, close: number) => (s: string): string =>
  enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;

/** Brand accent (cyan) - used for the infracodebase name in headers. */
export const brand = wrap(36, 39);
export const bold = wrap(1, 22);
/** Secondary text (version, paths, hints). */
export const dim = wrap(2, 22);
/** Success accent (green) - the setup confirmation check. */
export const green = wrap(32, 39);
