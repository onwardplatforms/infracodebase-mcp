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
    expect(String(fetchMock.mock.calls[0][1]?.body)).toMatch(/refresh_recovery_key=[^&]+/);
  });

  it("retries a transient refresh failure without telling the user to sign in again", async () => {
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
            refreshToken: "refresh-1",
            expiresAt: 1,
          },
        },
      })
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "refresh-2",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const getAccessToken = createStoredOAuthTokenProvider("https://example.com/api/v1", {
      credentialPath,
      fetch: fetchMock,
      now: () => 10_000,
    });

    await expect(getAccessToken()).resolves.toBe("new-access");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    const retryBody = new URLSearchParams(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryBody.get("refresh_recovery_key")).toBe(firstBody.get("refresh_recovery_key"));
  });

  it("preserves the saved login when transient refresh attempts are exhausted", async () => {
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
            refreshToken: "refresh-1",
            expiresAt: 1,
          },
        },
      })
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    );

    const getAccessToken = createStoredOAuthTokenProvider("https://example.com/api/v1", {
      credentialPath,
      fetch: fetchMock,
      now: () => 10_000,
    });

    await expect(getAccessToken()).rejects.toThrow("login is still saved");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const stored = JSON.parse(await readFile(credentialPath, "utf8"));
    expect(stored.instances["https://example.com"].refreshToken).toBe("refresh-1");
  });

  it("asks for a new login only when the server rejects the refresh grant", async () => {
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
            refreshToken: "refresh-1",
            expiresAt: 1,
          },
        },
      })
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );

    const getAccessToken = createStoredOAuthTokenProvider("https://example.com/api/v1", {
      credentialPath,
      fetch: fetchMock,
      now: () => 10_000,
    });

    await expect(getAccessToken()).rejects.toThrow("session has expired");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(await response.text()).toContain("You can close this window");
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

  it("does not reflect OAuth callback errors into the browser page", async () => {
    const credentialPath = await temporaryCredentialPath();
    const maliciousDescription = '<script>alert("xss")</script>';
    let pageAssertion: Promise<void> | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/mcp/oauth/register")) {
        return Response.json({ client_id: "client-1" }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      login("https://example.com/api/v1", {
        credentialPath,
        fetch: fetchMock as typeof fetch,
        openBrowser: async (url) => {
          const authorizationUrl = new URL(url);
          const callback = new URL(authorizationUrl.searchParams.get("redirect_uri")!);
          callback.searchParams.set("error", "access_denied");
          callback.searchParams.set("error_description", maliciousDescription);
          pageAssertion = fetch(callback).then(async (response) => {
            const page = await response.text();
            expect(response.status).toBe(400);
            expect(page).toContain("Return to your terminal for details");
            expect(page).not.toContain(maliciousDescription);
            expect(page).not.toContain("&lt;script&gt;");
          });
        },
      })
    ).rejects.toThrow(maliciousDescription);
    await pageAssertion;
  });

  it("revokes the server grant before removing only the selected instance on logout", async () => {
    const credentialPath = await temporaryCredentialPath();
    await mkdir(path.dirname(credentialPath), { recursive: true });
    await writeFile(
      credentialPath,
      JSON.stringify({
        version: 1,
        instances: {
          "https://one.example": {
            clientId: "client-1",
            resource: "https://one.example/api/v1",
            accessToken: "one",
            refreshToken: "refresh-1",
            expiresAt: 1,
          },
          "https://two.example": { accessToken: "two" },
        },
      })
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      logout("https://one.example/api/v1", { credentialPath, fetch: fetchMock })
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://one.example/api/mcp/oauth/revoke");
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("manual");
    const requestBody = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.get("token")).toBe("refresh-1");
    expect(requestBody.get("token_type_hint")).toBe("refresh_token");
    expect(requestBody.get("client_id")).toBe("client-1");
    const saved = JSON.parse(await readFile(credentialPath, "utf8"));
    expect(saved.instances).toEqual({ "https://two.example": { accessToken: "two" } });
  });

  it("preserves the saved login when server revocation cannot be confirmed", async () => {
    const credentialPath = await temporaryCredentialPath();
    await mkdir(path.dirname(credentialPath), { recursive: true });
    await writeFile(
      credentialPath,
      JSON.stringify({
        version: 1,
        instances: {
          "https://one.example": {
            clientId: "client-1",
            resource: "https://one.example/api/v1",
            accessToken: "one",
            refreshToken: "refresh-1",
            expiresAt: 1,
          },
        },
      })
    );
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));

    await expect(
      logout("https://one.example/api/v1", { credentialPath, fetch: fetchMock })
    ).rejects.toThrow("login is still saved");
    const saved = JSON.parse(await readFile(credentialPath, "utf8"));
    expect(saved.instances["https://one.example"].refreshToken).toBe("refresh-1");
  });
});
