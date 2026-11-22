/**
 * Per-instance CLI preferences, kept apart from credentials.json: that file is
 * locked and rewritten on every token refresh and holds secrets, this one holds
 * choices. Today the only choice is the enterprise to work in.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { defaultCredentialPath } from "./oauth.js";

export interface SavedEnterprise {
  id: string;
  name?: string;
  slug?: string;
}

interface SettingsFile {
  version: 1;
  instances: Record<string, { enterprise?: SavedEnterprise }>;
}

export function defaultSettingsPath(): string {
  return path.join(path.dirname(defaultCredentialPath()), "settings.json");
}

async function readSettings(filePath: string): Promise<SettingsFile> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<SettingsFile>;
    if (value.version === 1 && value.instances && typeof value.instances === "object") {
      return value as SettingsFile;
    }
  } catch {
    // Missing or unreadable: a preference file is never worth failing a command over.
  }
  return { version: 1, instances: {} };
}

/** The enterprise chosen for this instance, or null when none was chosen. */
export async function readSavedEnterprise(
  apiUrl: string,
  filePath = defaultSettingsPath()
): Promise<SavedEnterprise | null> {
  const settings = await readSettings(filePath);
  const saved = settings.instances[new URL(apiUrl).origin]?.enterprise;
  return saved && typeof saved.id === "string" && saved.id ? saved : null;
}

/** Save (or with null, forget) the enterprise for this instance. */
export async function saveEnterprise(
  apiUrl: string,
  enterprise: SavedEnterprise | null,
  filePath = defaultSettingsPath()
): Promise<void> {
  const settings = await readSettings(filePath);
  const origin = new URL(apiUrl).origin;
  const instance = { ...settings.instances[origin] };
  if (enterprise) instance.enterprise = enterprise;
  else delete instance.enterprise;
  settings.instances[origin] = instance;

  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}
