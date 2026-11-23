/**
 * Which enterprise the CLI works in. The sign-in token covers every enterprise
 * the person belongs to, so without a choice each tool call has to be told one
 * (and two enterprises can share a name). One enterprise is chosen silently;
 * several are asked about once, and the answer is remembered per instance.
 */

import type { InfracodebaseClient } from "./client.js";
import { readSavedEnterprise, saveEnterprise, type SavedEnterprise } from "./settings.js";

export interface EnterpriseRow {
  id: string;
  name?: string;
  slug?: string;
  role?: string;
}

/** A label that tells same-named enterprises apart: name, then slug and role. */
export function enterpriseLabel(row: EnterpriseRow): string {
  const detail = [row.slug, row.role && titleCase(row.role)].filter(Boolean).join(", ");
  const name = row.name || row.slug || row.id;
  return detail ? `${name} (${detail})` : name;
}

function titleCase(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function listEnterpriseRows(client: InfracodebaseClient): Promise<EnterpriseRow[]> {
  const res = await client.listEnterprises();
  return (res.data as EnterpriseRow[]).filter((row) => typeof row?.id === "string");
}

function toSaved(row: EnterpriseRow): SavedEnterprise {
  return { id: row.id, ...(row.name ? { name: row.name } : {}), ...(row.slug ? { slug: row.slug } : {}) };
}

export type EnterpriseChoice =
  | { kind: "none" }
  | { kind: "only"; enterprise: SavedEnterprise }
  | { kind: "chosen"; enterprise: SavedEnterprise }
  | { kind: "kept"; enterprise: SavedEnterprise }
  | { kind: "undecided"; count: number }
  | { kind: "unavailable"; error: string };

/**
 * Settle the enterprise after sign-in. `ask` is only called with two or more
 * rows; without it (no terminal) a still-valid earlier choice is kept and
 * otherwise nothing is saved, so tools keep asking for enterprise_id. A failed
 * enterprise lookup leaves the saved choice alone and returns "unavailable":
 * a preference is never worth failing sign-in or setup over.
 */
export async function settleEnterprise(options: {
  apiUrl: string;
  client: InfracodebaseClient;
  ask?: (rows: EnterpriseRow[], current: string | undefined) => Promise<EnterpriseRow | null>;
  settingsPath?: string;
}): Promise<EnterpriseChoice> {
  let rows: EnterpriseRow[];
  try {
    rows = await listEnterpriseRows(options.client);
  } catch (error) {
    return { kind: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
  const saved = await readSavedEnterprise(options.apiUrl, options.settingsPath);
  const stillValid = saved ? rows.find((row) => row.id === saved.id) : undefined;

  if (rows.length === 0) {
    if (saved) await saveEnterprise(options.apiUrl, null, options.settingsPath);
    return { kind: "none" };
  }
  if (rows.length === 1) {
    const enterprise = toSaved(rows[0]);
    await saveEnterprise(options.apiUrl, enterprise, options.settingsPath);
    return { kind: "only", enterprise };
  }
  if (options.ask) {
    const picked = await options.ask(rows, stillValid?.id);
    if (picked) {
      const enterprise = toSaved(picked);
      await saveEnterprise(options.apiUrl, enterprise, options.settingsPath);
      return { kind: "chosen", enterprise };
    }
  }
  if (stillValid) {
    // Refresh the cached name and slug in case either changed.
    const enterprise = toSaved(stillValid);
    await saveEnterprise(options.apiUrl, enterprise, options.settingsPath);
    return { kind: "kept", enterprise };
  }
  if (saved) await saveEnterprise(options.apiUrl, null, options.settingsPath);
  return { kind: "undecided", count: rows.length };
}

/**
 * The enterprise a read tool falls back to when enterprise_id is omitted:
 * INFRACODEBASE_ENTERPRISE_ID, then (browser sign-in only) the saved choice,
 * then the caller's only enterprise when they belong to exactly one. The saved
 * choice belongs to whoever ran `login`, so it is ignored under a token, which
 * may be someone else's. The single-enterprise lookup is made once per process
 * and retried after a failure.
 */
export function chosenEnterpriseResolver(options: {
  apiUrl: string;
  authKind: "oauth" | "legacy_token";
  client: InfracodebaseClient;
  settingsPath?: string;
}): () => Promise<string | undefined> {
  let onlyEnterprise: Promise<string | undefined> | undefined;
  return async () => {
    const fromEnv = process.env.INFRACODEBASE_ENTERPRISE_ID?.trim();
    if (fromEnv) return fromEnv;
    if (options.authKind === "oauth") {
      const saved = await readSavedEnterprise(options.apiUrl, options.settingsPath);
      if (saved) return saved.id;
    }
    onlyEnterprise ??= listEnterpriseRows(options.client).then(
      (rows) => (rows.length === 1 ? rows[0].id : undefined),
      () => {
        onlyEnterprise = undefined;
        return undefined;
      }
    );
    return onlyEnterprise;
  };
}

/** Find an enterprise by slug or id, for `infracodebase enterprise use`. */
export function findEnterprise(rows: EnterpriseRow[], key: string): EnterpriseRow | undefined {
  const wanted = key.trim().toLowerCase();
  return rows.find((row) => row.id.toLowerCase() === wanted || row.slug?.toLowerCase() === wanted);
}
