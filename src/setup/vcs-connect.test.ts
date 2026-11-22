import { describe, expect, it, vi } from "vitest";
import { ApiError, type InfracodebaseClient } from "../client.js";
import { missingConnections, offerVcsConnections, type ConnectionRow } from "./vcs-connect.js";

const URL_GH = "https://infracodebase.example/api/github/oauth/authorize?return_url=%2Fsettings%2Fconnections";
const NOT_CONNECTED: ConnectionRow[] = [
  // Two GitHub orgs: the person connects one GitHub account, offered once.
  { provider: "github", personal_connection: "not_connected", connect_url: URL_GH },
  { provider: "github", personal_connection: "not_connected", connect_url: URL_GH },
  { provider: "gitlab", personal_connection: "unsupported", connect_url: null },
];
const CONNECTED: ConnectionRow[] = [{ provider: "github", personal_connection: "connected", connect_url: null }];

function deps(responses: ConnectionRow[][], confirm: ((m: string) => Promise<boolean>) | null) {
  const listVcsConnections = vi.fn();
  for (const data of responses) listVcsConnections.mockResolvedValueOnce({ data });
  listVcsConnections.mockResolvedValue({ data: responses.at(-1) });
  const log = { success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const open = vi.fn(async () => undefined);
  return {
    client: { listVcsConnections } as unknown as InfracodebaseClient,
    enterpriseId: "ent_1",
    confirm,
    open,
    log,
    waiting: { start: vi.fn(), stop: vi.fn() },
    pollMs: 1,
    timeoutMs: 50,
    sleep: async () => undefined,
  };
}

describe("missingConnections", () => {
  it("offers each provider once, and only providers with a personal connection", () => {
    expect(missingConnections(NOT_CONNECTED)).toEqual([{ provider: "github", url: URL_GH }]);
  });
});

describe("offerVcsConnections", () => {
  it("opens the connect page on yes and confirms once the connection lands", async () => {
    const d = deps([NOT_CONNECTED, NOT_CONNECTED, CONNECTED], async () => true);
    await offerVcsConnections(d);

    expect(d.open).toHaveBeenCalledWith(URL_GH);
    expect(d.log.success).toHaveBeenCalledWith("GitHub account connected");
    expect(d.log.warn).not.toHaveBeenCalled();
  });

  it("skips on no and says where to connect later, without opening anything", async () => {
    const d = deps([NOT_CONNECTED], async () => false);
    await offerVcsConnections(d);

    expect(d.open).not.toHaveBeenCalled();
    expect(d.log.info).toHaveBeenCalledWith(`Skipped. Connect it any time at ${URL_GH}`);
  });

  it("does not ask about a provider that is already connected", async () => {
    const confirm = vi.fn(async () => true);
    const d = deps([CONNECTED], confirm);
    await offerVcsConnections(d);

    expect(confirm).not.toHaveBeenCalled();
    expect(d.log.success).toHaveBeenCalledWith("GitHub account connected");
  });

  it("lists the link instead of asking when there is no terminal", async () => {
    const d = deps([NOT_CONNECTED], null);
    await offerVcsConnections(d);

    expect(d.open).not.toHaveBeenCalled();
    expect(d.log.info).toHaveBeenCalledWith(expect.stringContaining(URL_GH));
  });

  it("says where to finish when the connection doesn't land in time", async () => {
    const d = deps([NOT_CONNECTED], async () => true);
    await offerVcsConnections(d);

    expect(d.log.warn).toHaveBeenCalledWith(expect.stringContaining(URL_GH));
    expect(d.waiting.stop).toHaveBeenCalled();
  });

  it("says why for each provider, without claiming Azure DevOps grants workspace access", async () => {
    const confirm = vi.fn(async () => false);
    const d = deps(
      [
        [
          { provider: "github", personal_connection: "not_connected", connect_url: URL_GH },
          { provider: "azure-devops", personal_connection: "not_connected", connect_url: "https://x/ado" },
        ],
      ],
      confirm
    );
    await offerVcsConnections(d);

    expect(confirm.mock.calls[0][0]).toContain("access to workspaces through your repository permissions");
    expect(confirm.mock.calls[1][0]).toContain("create repositories as you");
    expect(confirm.mock.calls[1][0]).not.toContain("workspaces");
  });

  it("warns, with the server's words, when the enterprise has no active plan", async () => {
    const d = deps([], async () => true);
    (d.client.listVcsConnections as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockRejectedValue(
        new ApiError(402, JSON.stringify({ message: "The free plan has ended." }), "/connections")
      );
    await offerVcsConnections(d);
    expect(d.log.warn).toHaveBeenCalledWith("The free plan has ended.");
  });

  it("is silent against a server that predates personal_connection, and never fails init", async () => {
    const old = deps([[{ provider: "github" }]], vi.fn(async () => true));
    await offerVcsConnections(old);
    expect(old.confirm).not.toHaveBeenCalled();

    const failing = deps([], async () => true);
    (failing.client.listVcsConnections as ReturnType<typeof vi.fn>).mockReset().mockRejectedValue(new Error("down"));
    await expect(offerVcsConnections(failing)).resolves.toBeUndefined();
  });
});
