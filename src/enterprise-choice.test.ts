import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfracodebaseClient } from "./client.js";
import { enterpriseLabel, findEnterprise, settleEnterprise, type EnterpriseRow } from "./enterprise-choice.js";
import { readSavedEnterprise, saveEnterprise } from "./settings.js";

const API = "https://infracodebase.example/api/v1";
const ACME = { id: "ent_acme", name: "Acme", slug: "acme", role: "MEMBER" };
// Two enterprises with the same name, as seen live on prod.
const MINE_A = { id: "ent_a", name: "Reilly's Enterprise", slug: "reilly-2", role: "VIEWER" };
const MINE_B = { id: "ent_b", name: "Reilly's Enterprise", slug: "reilly", role: "OWNER" };

let dir: string;
let settingsPath: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "icb-settings-"));
  settingsPath = path.join(dir, "settings.json");
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function clientWith(rows: EnterpriseRow[]): InfracodebaseClient {
  return { listEnterprises: vi.fn(async () => ({ data: rows })) } as unknown as InfracodebaseClient;
}

describe("settleEnterprise", () => {
  it("chooses the only enterprise without asking and remembers it", async () => {
    const ask = vi.fn();
    const choice = await settleEnterprise({ apiUrl: API, client: clientWith([ACME]), ask, settingsPath });

    expect(choice).toEqual({ kind: "only", enterprise: { id: "ent_acme", name: "Acme", slug: "acme" } });
    expect(ask).not.toHaveBeenCalled();
    expect(await readSavedEnterprise(API, settingsPath)).toEqual({ id: "ent_acme", name: "Acme", slug: "acme" });
  });

  it("asks once with several, offering the earlier choice first, and remembers the answer", async () => {
    await saveEnterprise(API, { id: "ent_b" }, settingsPath);
    const ask = vi.fn(async (rows: EnterpriseRow[]) => rows[0]);

    const choice = await settleEnterprise({
      apiUrl: API,
      client: clientWith([MINE_A, MINE_B]),
      ask,
      settingsPath,
    });

    expect(ask).toHaveBeenCalledWith([MINE_A, MINE_B], "ent_b");
    expect(choice).toMatchObject({ kind: "chosen", enterprise: { id: "ent_a" } });
    expect((await readSavedEnterprise(API, settingsPath))?.id).toBe("ent_a");
  });

  it("keeps a still-valid choice when there is no terminal to ask in", async () => {
    await saveEnterprise(API, { id: "ent_b" }, settingsPath);
    const choice = await settleEnterprise({ apiUrl: API, client: clientWith([MINE_A, MINE_B]), settingsPath });
    expect(choice).toMatchObject({ kind: "kept", enterprise: { id: "ent_b", slug: "reilly" } });
  });

  it("forgets a choice the person no longer belongs to, and leaves it undecided", async () => {
    await saveEnterprise(API, { id: "ent_gone" }, settingsPath);
    const choice = await settleEnterprise({ apiUrl: API, client: clientWith([MINE_A, MINE_B]), settingsPath });
    expect(choice).toEqual({ kind: "undecided", count: 2 });
    expect(await readSavedEnterprise(API, settingsPath)).toBeNull();
  });

  it("keeps choices per instance", async () => {
    await saveEnterprise("https://other.example/api/v1", { id: "ent_other" }, settingsPath);
    await settleEnterprise({ apiUrl: API, client: clientWith([ACME]), settingsPath });
    expect((await readSavedEnterprise("https://other.example/api/v1", settingsPath))?.id).toBe("ent_other");
  });
});

describe("enterpriseLabel", () => {
  it("tells same-named enterprises apart by slug and role", () => {
    expect(enterpriseLabel(MINE_A)).toBe("Reilly's Enterprise (reilly-2, Viewer)");
    expect(enterpriseLabel(MINE_B)).toBe("Reilly's Enterprise (reilly, Owner)");
    expect(enterpriseLabel({ id: "e", name: "Ops", role: "COMPLIANCE_OFFICER" })).toBe(
      "Ops (Compliance Officer)"
    );
  });
});

describe("findEnterprise", () => {
  it("matches by slug or id, ignoring case", () => {
    expect(findEnterprise([MINE_A, MINE_B], "REILLY")?.id).toBe("ent_b");
    expect(findEnterprise([MINE_A, MINE_B], "ent_a")?.slug).toBe("reilly-2");
    expect(findEnterprise([MINE_A, MINE_B], "nope")).toBeUndefined();
  });
});
