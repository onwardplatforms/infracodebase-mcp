/**
 * The init step that offers each personal version control connection the
 * chosen enterprise needs. A person's own connection (GitHub today) is what
 * lets their repository permissions grant them workspace access, and what
 * infracodebase creates repositories with. Without it a developer usually
 * finds out only when a tool fails. Always skippable, and never fails init.
 */

import type { InfracodebaseClient } from "../client.js";

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
  } catch {
    // Listing connections needs nothing init cannot do without.
    return;
  }

  for (const provider of connectedProviders(rows)) {
    deps.log.success(`${providerLabel(provider)} account connected`);
  }

  for (const { provider, url } of missingConnections(rows)) {
    const label = providerLabel(provider);
    const why = `Connecting your ${label} account gives you access to workspaces through your repository permissions.`;
    if (!deps.confirm) {
      deps.log.info(`${why} Connect it at ${url}`);
      continue;
    }
    if (!(await deps.confirm(`Connect your ${label} account? ${why}`))) {
      deps.log.info(`Skipped. Connect it any time at ${url}`);
      continue;
    }

    await deps.open(url);
    deps.waiting.start(`Waiting for you to connect ${label} in the browser`);
    const deadline = Date.now() + (deps.timeoutMs ?? 180_000);
    let connected = false;
    while (Date.now() < deadline) {
      await sleep(deps.pollMs ?? 2_000);
      try {
        const now = await readRows(deps.client, deps.enterpriseId);
        if (connectedProviders(now).includes(provider)) {
          connected = true;
          break;
        }
      } catch {
        // A blip while polling is not a failure; keep waiting until the deadline.
      }
    }
    if (connected) {
      deps.waiting.stop();
      deps.log.success(`${label} account connected`);
    } else {
      deps.waiting.stop();
      deps.log.warn(`Didn't see the ${label} connection finish. Connect it any time at ${url}`);
    }
  }
}
