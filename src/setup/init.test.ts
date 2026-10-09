import { describe, expect, it } from "vitest";
import { findClient } from "./clients.js";
import { parseClientIds, planPicker, serverLaunch, type ClientState, type ClientStatus } from "./init.js";

function state(id: string, detected: boolean, status: ClientStatus): ClientState {
  const existingApiUrl = status === "other-instance" ? "https://infracodebase.com/api/v1" : undefined;
  return { client: findClient(id)!, detected, status, existingApiUrl };
}

describe("serverLaunch", () => {
  it("pins a dedicated instance's API URL and leaves the SaaS default implicit", () => {
    expect(serverLaunch("https://nextera.example.com/api/v1", "linux")).toEqual({
      command: "npx",
      args: ["-y", "@infracodebase/mcp@latest", "--api-url", "https://nextera.example.com/api/v1"],
    });
    expect(serverLaunch("https://infracodebase.com/api/v1", "darwin")).toEqual({
      command: "npx",
      args: ["-y", "@infracodebase/mcp@latest"],
    });
  });

  it("runs npx through cmd on Windows, where clients cannot start a .cmd shim directly", () => {
    expect(serverLaunch("https://nextera.example.com/api/v1", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", "@infracodebase/mcp@latest", "--api-url", "https://nextera.example.com/api/v1"],
    });
  });
});

describe("parseClientIds", () => {
  it("keeps known clients once each and reports the unknown ones", () => {
    const { clients, unknown } = parseClientIds(["cursor", "cursor", "emacs", "codex"], "darwin");
    expect(clients.map((client) => client.id)).toEqual(["cursor", "codex"]);
    expect(unknown).toEqual(["emacs"]);
  });

  it("treats a client that does not ship on this OS as unknown", () => {
    expect(parseClientIds(["claude-desktop"], "linux").unknown).toEqual(["claude-desktop"]);
    expect(parseClientIds(["claude-desktop"], "win32").clients.map((client) => client.id)).toEqual([
      "claude-desktop",
    ]);
  });
});

describe("planPicker", () => {
  it("pre-checks detected clients that are not set up yet", () => {
    const plan = planPicker([
      state("claude-code", true, "missing"),
      state("cursor", true, "missing"),
      state("windsurf", false, "missing"),
    ]);
    expect(plan.choices.map((choice) => [choice.client.id, choice.preselected, choice.hint])).toEqual([
      ["claude-code", true, "detected"],
      ["cursor", true, "detected"],
      ["windsurf", false, undefined],
    ]);
    expect(plan.nothingToSuggest).toBe(false);
  });

  it("reports clients already set up and asks before offering more", () => {
    const plan = planPicker([
      state("claude-code", true, "current"),
      state("cursor", true, "current"),
      state("windsurf", false, "missing"),
    ]);
    expect(plan.current.map((client) => client.id)).toEqual(["claude-code", "cursor"]);
    expect(plan.choices.map((choice) => choice.client.id)).toEqual(["windsurf"]);
    expect(plan.nothingToSuggest).toBe(true);
  });

  it("never pre-checks a client pointed at another instance", () => {
    const plan = planPicker([state("cursor", true, "other-instance"), state("codex", true, "current")]);
    expect(plan.choices).toEqual([
      expect.objectContaining({
        preselected: false,
        hint: "uses infracodebase.com",
      }),
    ]);
    expect(plan.nothingToSuggest).toBe(true);
  });

  it("starts with nothing checked when no client is installed", () => {
    const plan = planPicker([state("cursor", false, "missing"), state("vscode", false, "missing")]);
    expect(plan.choices.every((choice) => !choice.preselected)).toBe(true);
    expect(plan.nothingToSuggest).toBe(false);
  });
});
