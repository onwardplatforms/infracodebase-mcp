/**
 * `infracodebase enterprise`: show the enterprise the CLI works in.
 * `infracodebase enterprise use [slug]`: switch to another one (asks when no
 * slug is given in a terminal). No new sign-in is needed: the session already
 * covers every enterprise the person belongs to.
 */

import { InfracodebaseClient } from "../client.js";
import type { Config } from "../config.js";
import {
  enterpriseLabel,
  findEnterprise,
  listEnterpriseRows,
  type EnterpriseRow,
} from "../enterprise-choice.js";
import { readSavedEnterprise, saveEnterprise } from "../settings.js";
import { askEnterprise } from "../setup/init.js";

export async function runEnterpriseCommand(args: string[], config: Config): Promise<void> {
  const client = new InfracodebaseClient({
    baseUrl: config.apiUrl,
    getAccessToken: config.getAccessToken,
    authKind: config.authKind,
  });
  const rows = await listEnterpriseRows(client);
  const saved = await readSavedEnterprise(config.apiUrl);

  if (args[0] !== "use") {
    console.error(describeCurrent(rows, saved?.id, config.authKind));
    if (rows.length > 1) {
      console.error("\nYour enterprises:");
      for (const row of rows) console.error(`  ${enterpriseLabel(row)}`);
      console.error("\nSwitch with: infracodebase enterprise use <slug>");
    }
    return;
  }

  const key = args[1];
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const picked = key
    ? findEnterprise(rows, key)
    : interactive
      ? await askEnterprise(rows, saved?.id)
      : undefined;
  if (!picked) {
    throw new Error(
      key
        ? `You don't belong to an enterprise with slug or id "${key}". Run \`infracodebase enterprise\` to list yours.`
        : "Pass the enterprise's slug: infracodebase enterprise use <slug>"
    );
  }
  await saveEnterprise(config.apiUrl, { id: picked.id, name: picked.name, slug: picked.slug });
  console.error(`Working in ${enterpriseLabel(picked)}.`);
  const override = overrideNote(config.authKind);
  if (override) console.error(override);
}

/**
 * What tools actually use, in the order the server resolves it:
 * INFRACODEBASE_ENTERPRISE_ID, then the saved choice (browser sign-in only),
 * then the only enterprise.
 */
export function describeCurrent(
  rows: EnterpriseRow[],
  savedId: string | undefined,
  authKind: Config["authKind"]
): string {
  const label = (id: string) => {
    const row = rows.find((r) => r.id === id);
    return row ? enterpriseLabel(row) : id;
  };
  const fromEnv = process.env.INFRACODEBASE_ENTERPRISE_ID?.trim();
  if (fromEnv) return `Working in ${label(fromEnv)} (set by INFRACODEBASE_ENTERPRISE_ID).`;
  if (savedId && authKind === "oauth" && rows.some((row) => row.id === savedId)) {
    return `Working in ${label(savedId)}.`;
  }
  if (rows.length === 1) return `Working in ${enterpriseLabel(rows[0])} (your only enterprise).`;
  if (authKind === "legacy_token") {
    return "No enterprise chosen. Under INFRACODEBASE_TOKEN the sign-in choice is ignored; set INFRACODEBASE_ENTERPRISE_ID to choose one.";
  }
  return "No enterprise chosen.";
}

function overrideNote(authKind: Config["authKind"]): string | undefined {
  if (process.env.INFRACODEBASE_ENTERPRISE_ID?.trim()) {
    return "INFRACODEBASE_ENTERPRISE_ID is set and takes precedence over this choice.";
  }
  if (authKind === "legacy_token") {
    return "INFRACODEBASE_TOKEN is set; tools using it ignore this choice. Set INFRACODEBASE_ENTERPRISE_ID instead.";
  }
  return undefined;
}
