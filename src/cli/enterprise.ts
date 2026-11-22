/**
 * `infracodebase enterprise`: show the enterprise the CLI works in.
 * `infracodebase enterprise use [slug]`: switch to another one (asks when no
 * slug is given in a terminal). No new sign-in is needed: the session already
 * covers every enterprise the person belongs to.
 */

import { InfracodebaseClient } from "../client.js";
import type { Config } from "../config.js";
import { enterpriseLabel, findEnterprise, listEnterpriseRows } from "../enterprise-choice.js";
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
    const current = saved ? rows.find((row) => row.id === saved.id) : undefined;
    console.error(current ? `Working in ${enterpriseLabel(current)}.` : "No enterprise chosen.");
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
}
