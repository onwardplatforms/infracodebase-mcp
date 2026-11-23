/**
 * The init step that offers each personal version control connection the
 * chosen enterprise needs. A person's own connection (GitHub today) is what
 * lets their repository permissions grant them workspace access, and what
 * infracodebase creates repositories with. Without it a developer usually
 * finds out only when a tool fails. Always skippable, and never fails init.
 */

import { ApiError, type InfracodebaseClient } from "../client.js";

export interface ConnectionRow {
  provider: string;
  personal_connection?: "connected" | "not_connected" | "unsupported" | null;
  connect_url?: string | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  "azure-devops": "Azure DevOps",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** The server's message from an API error body, else the error's own text. */
function apiMessage(err: ApiError): string {
  try {
    const body = JSON.parse(err.body) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // Not JSON: fall through.
  }
  return err.message;
}

/** One entry per provider the person can and has not yet connected. */
export function missingConnections(rows: ConnectionRow[]): Array<{ provider: string; url: string }> {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (row.personal_connection === "not_connected" && row.connect_url && !seen.has(row.provider)) {
      seen.set(row.provider, row.connect_url);
    }
  }
  return [...seen].map(([provider, url]) => ({ provider, url }));
}

export function connectedProviders(rows: ConnectionRow[]): string[] {
  return [
    ...new Set(rows.filter((row) => row.personal_connection === "connected").map((row) => row.provider)),
  ];
}

export interface OfferDeps {
  client: InfracodebaseClient;
  enterpriseId: string;
  /** Null when there is no terminal to ask in: missing connections are listed, not offered. */
  confirm: ((message: string) => Promise<boolean>) | null;
  /** Opens the connect page; with --no-open it prints the URL instead. */
  open: (url: string) => Promise<void>;
  log: { success(text: string): void; info(text: string): void; warn(text: string): void };
  /** Spinner-style wait while the person finishes in the browser. */
  waiting: { start(text: string): void; stop(text?: string): void };
  /**
   * Starts listening for the person to skip the wait (Enter in a terminal).
   * `pressed` resolves on a skip; `dispose` stops listening. Absent: the wait
   * runs until the connection lands or the timeout.
   */
  listenForSkip?: () => { pressed: Promise<void>; dispose(): void };
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

async function readRows(client: InfracodebaseClient, enterpriseId: string): Promise<ConnectionRow[]> {
  const res = (await client.listVcsConnections(enterpriseId)) as { data?: ConnectionRow[] };
  return Array.isArray(res?.data) ? res.data : [];
}

/**
 * Offer each missing connection, then wait for it to land. Rows from a server
 * that predates `personal_connection` carry nothing to offer, so the step is
 * silent there.
 */
export async function offerVcsConnections(deps: OfferDeps): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let rows: ConnectionRow[];
  try {
    rows = await readRows(deps.client, deps.enterpriseId);
  } catch (err) {
    // An enterprise without an active plan (402) refuses every later tool
    // call too, so say so now instead of finishing as if all is well. Any
    // other failure is not worth failing init over.
    if (err instanceof ApiError && err.status === 402) deps.log.warn(apiMessage(err));
    return;
  }

  for (const provider of connectedProviders(rows)) {
    deps.log.success(`${providerLabel(provider)} account connected`);
  }

  for (const { provider, url } of missingConnections(rows)) {
    const label = providerLabel(provider);
    if (!deps.confirm) {
      deps.log.info(`Connect to ${label} at ${url}`);
      continue;
    }
    if (!(await deps.confirm(`Connect to ${label}?`))) {
      deps.log.info(`Skipped. Connect it any time at ${url}`);
      continue;
    }

    await deps.open(url);
    const skip = deps.listenForSkip?.();
    deps.waiting.start(
      `Waiting for you to connect ${label} in the browser${skip ? " (press Enter to skip)" : ""}`
    );
    let outcome: "connected" | "skipped" | "timed_out" = "timed_out";
    try {
      outcome = await waitForConnection(deps, provider, sleep, skip?.pressed);
    } finally {
      skip?.dispose();
      deps.waiting.stop();
    }
    if (outcome === "connected") deps.log.success(`${label} account connected`);
    else if (outcome === "skipped") deps.log.info(`Skipped. Connect it any time at ${url}`);
    else deps.log.warn(`Didn't see the ${label} connection finish. Connect it any time at ${url}`);
  }
}

async function waitForConnection(
  deps: OfferDeps,
  provider: string,
  sleep: (ms: number) => Promise<void>,
  skipped: Promise<void> | undefined
): Promise<"connected" | "skipped" | "timed_out"> {
  const skip = skipped?.then(() => "skipped" as const) ?? new Promise<never>(() => undefined);
  const deadline = Date.now() + (deps.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    if ((await Promise.race([sleep(deps.pollMs ?? 2_000).then(() => "tick" as const), skip])) === "skipped") {
      return "skipped";
    }
    try {
      const now = await readRows(deps.client, deps.enterpriseId);
      if (connectedProviders(now).includes(provider)) return "connected";
    } catch {
      // A blip while polling is not a failure; keep waiting until the deadline.
    }
  }
  return "timed_out";
}
