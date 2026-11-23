import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfracodebaseClient } from "./client.js";
import {
  chosenEnterpriseResolver,
  enterpriseLabel,
  findEnterprise,
  settleEnterprise,
  type EnterpriseRow,
} from "./enterprise-choice.js";
import { describeCurrent } from "./cli/enterprise.js";
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

  it("returns unavailable without touching the saved choice when the lookup fails", async () => {
    await saveEnterprise(API, { id: "ent_b" }, settingsPath);
    const client = {
      listEnterprises: vi.fn(async () => {
        throw new Error("503 Service Unavailable");
      }),
    } as unknown as InfracodebaseClient;

    const choice = await settleEnterprise({ apiUrl: API, client, settingsPath });

    expect(choice).toEqual({ kind: "unavailable", error: "503 Service Unavailable" });
    expect((await readSavedEnterprise(API, settingsPath))?.id).toBe("ent_b");
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

describe("chosenEnterpriseResolver", () => {
  afterEach(() => {
    delete process.env.INFRACODEBASE_ENTERPRISE_ID;
  });

  it("uses the saved choice under browser sign-in", async () => {
    await saveEnterprise(API, { id: "ent_b" }, settingsPath);
    const resolve = chosenEnterpriseResolver({
      apiUrl: API,
      authKind: "oauth",
      client: clientWith([MINE_A, MINE_B]),
      settingsPath,
    });
    expect(await resolve()).toBe("ent_b");
  });

  it("ignores the saved choice under a token, which may be someone else's", async () => {
    await saveEnterprise(API, { id: "ent_b" }, settingsPath);
    const resolve = chosenEnterpriseResolver({
      apiUrl: API,
      authKind: "legacy_token",
      client: clientWith([MINE_A, MINE_B]),
      settingsPath,
    });
    expect(await resolve()).toBeUndefined();
  });

  it("prefers INFRACODEBASE_ENTERPRISE_ID over everything", async () => {
    process.env.INFRACODEBASE_ENTERPRISE_ID = "ent_env";
    await saveEnterprise(API, { id: "ent_b" }, settingsPath);
    const resolve = chosenEnterpriseResolver({
      apiUrl: API,
      authKind: "oauth",
      client: clientWith([MINE_A, MINE_B]),
      settingsPath,
    });
    expect(await resolve()).toBe("ent_env");
  });

  it("falls back to the only enterprise when nothing was chosen, looking it up once", async () => {
    const client = clientWith([ACME]);
    const resolve = chosenEnterpriseResolver({ apiUrl: API, authKind: "legacy_token", client, settingsPath });
    expect(await resolve()).toBe("ent_acme");
    expect(await resolve()).toBe("ent_acme");
    expect(client.listEnterprises).toHaveBeenCalledTimes(1);
  });

  it("does not guess among several enterprises, and retries a failed lookup", async () => {
    expect(
      await chosenEnterpriseResolver({
        apiUrl: API,
        authKind: "oauth",
        client: clientWith([MINE_A, MINE_B]),
        settingsPath,
      })()
    ).toBeUndefined();

    const listEnterprises = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ data: [ACME] });
    const resolve = chosenEnterpriseResolver({
      apiUrl: API,
      authKind: "oauth",
      client: { listEnterprises } as unknown as InfracodebaseClient,
      settingsPath,
    });
    expect(await resolve()).toBeUndefined();
    expect(await resolve()).toBe("ent_acme");
  });
});

describe("describeCurrent", () => {
  afterEach(() => {
    delete process.env.INFRACODEBASE_ENTERPRISE_ID;
  });

  it("reports INFRACODEBASE_ENTERPRISE_ID when it is what tools use", () => {
    process.env.INFRACODEBASE_ENTERPRISE_ID = "ent_a";
    expect(describeCurrent([MINE_A, MINE_B], "ent_b", "oauth")).toBe(
      "Working in Reilly's Enterprise (reilly-2, Viewer) (set by INFRACODEBASE_ENTERPRISE_ID)."
    );
  });

  it("reports the saved choice only under browser sign-in", () => {
    expect(describeCurrent([MINE_A, MINE_B], "ent_b", "oauth")).toBe(
      "Working in Reilly's Enterprise (reilly, Owner)."
    );
    expect(describeCurrent([MINE_A, MINE_B], "ent_b", "legacy_token")).toMatch(/ignored/);
  });
});
