import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredOAuthTokenProvider, login, logout } from "./oauth.js";

const temporaryDirectories: string[] = [];

async function temporaryCredentialPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "infracodebase-oauth-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "config", "credentials.json");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("stored OAuth sessions", () => {
  it("directs users to login when no session exists", async () => {
    const credentialPath = await temporaryCredentialPath();
    const getAccessToken = createStoredOAuthTokenProvider("https://example.com/api/v1", {
      credentialPath,
    });

    await expect(getAccessToken()).rejects.toThrow("infracodebase login");
  });

  it("refreshes an expired access token and persists refresh-token rotation", async () => {
    const credentialPath = await temporaryCredentialPath();
    await mkdir(path.dirname(credentialPath), { recursive: true });
    await writeFile(
      credentialPath,
      JSON.stringify({
        version: 1,
        instances: {
          "https://example.com": {
            clientId: "client-1",
            resource: "https://example.com/api/v1",
            accessToken: "expired-access",
            refreshToken: "old-refresh",
            expiresAt: 1,
          },
        },
      })
    );
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 600,
      })
    );
    const getAccessToken = createStoredOAuthTokenProvider("https://example.com/api/v1", {
      credentialPath,
      fetch: fetchMock as typeof fetch,
      now: () => 10_000,
    });

    await expect(getAccessToken()).resolves.toBe("new-access");
    const saved = JSON.parse(await readFile(credentialPath, "utf8"));
    expect(saved.instances["https://example.com"]).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 610_000,
    });
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain("refresh_token=old-refresh");
  });

  it("completes PKCE browser login and saves credentials with mode 0600", async () => {
    const credentialPath = await temporaryCredentialPath();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/mcp/oauth/register")) {
        return Response.json({ client_id: "client-1" }, { status: 201 });
      }
      if (url.endsWith("/api/mcp/oauth/token")) {
        return Response.json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 600,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await login("https://example.com/api/v1", {
      credentialPath,
      fetch: fetchMock as typeof fetch,
      now: () => 1_000,
      openBrowser: async (url) => {
        const authorizationUrl = new URL(url);
        expect(authorizationUrl.pathname).toBe("/mcp/authorize");
        expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
        const callback = new URL(authorizationUrl.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "authorization-code");
        callback.searchParams.set("state", authorizationUrl.searchParams.get("state")!);
        const response = await fetch(callback);
        expect(response.status).toBe(200);
      },
    });

    const saved = JSON.parse(await readFile(credentialPath, "utf8"));
    expect(saved.instances["https://example.com"]).toMatchObject({
      clientId: "client-1",
      resource: "https://example.com/api/v1",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 601_000,
    });
    expect((await stat(credentialPath)).mode & 0o777).toBe(0o600);

    const tokenRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/mcp/oauth/token")
    );
    expect(String(tokenRequest?.[1]?.body)).toContain("code_verifier=");
  });

  it("removes only the selected instance on logout", async () => {
    const credentialPath = await temporaryCredentialPath();
    await mkdir(path.dirname(credentialPath), { recursive: true });
    await writeFile(
      credentialPath,
      JSON.stringify({
        version: 1,
        instances: {
          "https://one.example": { accessToken: "one" },
          "https://two.example": { accessToken: "two" },
        },
      })
    );

    await expect(logout("https://one.example/api/v1", { credentialPath })).resolves.toBe(true);
    const saved = JSON.parse(await readFile(credentialPath, "utf8"));
    expect(saved.instances).toEqual({ "https://two.example": { accessToken: "two" } });
  });
});
