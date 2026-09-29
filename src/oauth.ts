import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const REFRESH_SKEW_MS = 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;

interface StoredCredential {
  clientId: string;
  resource: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface CredentialFile {
  version: 1;
  instances: Record<string, StoredCredential>;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface RegistrationResponse {
  client_id: string;
}

export interface OAuthOptions {
  credentialPath?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface LoginOptions extends OAuthOptions {
  openBrowser?: (url: string) => Promise<void>;
  timeoutMs?: number;
}

function instanceOrigin(apiUrl: string): string {
  return new URL(apiUrl).origin;
}

function resourceUrl(apiUrl: string): string {
  return new URL(apiUrl).toString().replace(/\/$/, "");
}

export function defaultCredentialPath(): string {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configRoot, "infracodebase", "credentials.json");
}

async function readCredentialFile(filePath: string): Promise<CredentialFile> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<CredentialFile>;
    if (value.version !== 1 || !value.instances || typeof value.instances !== "object") {
      throw new Error("unsupported credential file");
    }
    return value as CredentialFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, instances: {} };
    }
    throw new Error(
      `Could not read InfraCodebase credentials at ${filePath}. Run \`infracodebase login\` again.`,
      { cause: error }
    );
  }
}

async function writeCredentialFile(filePath: string, value: CredentialFile): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600);
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

async function withCredentialLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      try {
        return await operation();
      } finally {
        await handle.close();
        await fs.unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
        await fs.unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error("InfraCodebase credentials are busy. Wait a moment and try again.");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function responseJson<T>(response: Response, action: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | ({ error?: string; error_description?: string } & T)
    | null;
  if (!response.ok) {
    const detail = body?.error_description || body?.error || `HTTP ${response.status}`;
    throw new Error(`${action} failed: ${detail}`);
  }
  return body as T;
}

async function refreshCredential(
  apiUrl: string,
  credential: StoredCredential,
  fetchImpl: typeof fetch,
  now: () => number
): Promise<StoredCredential> {
  const response = await fetchImpl(`${instanceOrigin(apiUrl)}/api/mcp/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      client_id: credential.clientId,
      resource: credential.resource,
    }),
  });
  const tokens = await responseJson<TokenResponse>(response, "Refreshing the session");
  return {
    ...credential,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: now() + tokens.expires_in * 1000,
  };
}

export function createStoredOAuthTokenProvider(
  apiUrl: string,
  options: OAuthOptions = {}
): () => Promise<string> {
  const filePath = options.credentialPath ?? defaultCredentialPath();
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const origin = instanceOrigin(apiUrl);

  return async () => {
    const initial = (await readCredentialFile(filePath)).instances[origin];
    if (!initial) {
      throw new Error(
        `No InfraCodebase login found for ${origin}. Run \`infracodebase login --api-url ${apiUrl}\`.`
      );
    }
    if (initial.expiresAt > now() + REFRESH_SKEW_MS) return initial.accessToken;

    return withCredentialLock(filePath, async () => {
      const credentials = await readCredentialFile(filePath);
      const current = credentials.instances[origin];
      if (!current) {
        throw new Error(
          `No InfraCodebase login found for ${origin}. Run \`infracodebase login --api-url ${apiUrl}\`.`
        );
      }
      if (current.expiresAt > now() + REFRESH_SKEW_MS) return current.accessToken;

      let refreshed: StoredCredential;
      try {
        refreshed = await refreshCredential(apiUrl, current, fetchImpl, now);
      } catch (error) {
        throw new Error(
          `Your InfraCodebase session has expired. Run \`infracodebase login --api-url ${apiUrl}\` again.`,
          { cause: error }
        );
      }
      credentials.instances[origin] = refreshed;
      await writeCredentialFile(filePath, credentials);
      return refreshed.accessToken;
    });
  };
}

export async function logout(apiUrl: string, options: OAuthOptions = {}): Promise<boolean> {
  const filePath = options.credentialPath ?? defaultCredentialPath();
  const origin = instanceOrigin(apiUrl);
  return withCredentialLock(filePath, async () => {
    const credentials = await readCredentialFile(filePath);
    if (!credentials.instances[origin]) return false;
    delete credentials.instances[origin];
    await writeCredentialFile(filePath, credentials);
    return true;
  });
}

async function launchBrowser(url: string): Promise<void> {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function randomUrlSafe(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function login(apiUrl: string, options: LoginOptions = {}): Promise<void> {
  const origin = instanceOrigin(apiUrl);
  const resource = resourceUrl(apiUrl);
  const filePath = options.credentialPath ?? defaultCredentialPath();
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const state = randomUrlSafe();
  const verifier = randomUrlSafe(48);

  let resolveCallback!: (value: { code: string; state: string }) => void;
  let rejectCallback!: (reason: Error) => void;
  const callback = new Promise<{ code: string; state: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = http.createServer((request, response) => {
    const callbackUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (callbackUrl.pathname !== "/oauth/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    const returnedState = callbackUrl.searchParams.get("state") || "";
    const code = callbackUrl.searchParams.get("code") || "";
    const oauthError = callbackUrl.searchParams.get("error");
    if (oauthError) {
      const description = callbackUrl.searchParams.get("error_description") || oauthError;
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`InfraCodebase was not connected: ${description}\nYou can close this window.`);
      rejectCallback(new Error(description));
      return;
    }
    if (!code || returnedState !== state) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("This authorization response is invalid. Return to the terminal and try again.");
      rejectCallback(new Error("The OAuth callback was missing a valid code or state."));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("InfraCodebase is connected. You can close this window.");
    resolveCallback({ code, state: returnedState });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not start OAuth callback.");
    const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
    const registrationResponse = await fetchImpl(`${origin}/api/mcp/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "InfraCodebase CLI",
        client_uri: "https://github.com/onwardplatforms/infracodebase-mcp",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    const registration = await responseJson<RegistrationResponse>(
      registrationResponse,
      "Registering the CLI"
    );
    const authorizationUrl = new URL("/mcp/authorize", origin);
    authorizationUrl.search = new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      resource,
      scope: "read execute",
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();

    await (options.openBrowser ?? launchBrowser)(authorizationUrl.toString());
    const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
    let timeout: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      callback,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Login timed out. Run `infracodebase login` to try again.")),
          timeoutMs
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    const tokenResponse = await fetchImpl(`${origin}/api/mcp/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: result.code,
        redirect_uri: redirectUri,
        client_id: registration.client_id,
        resource,
        code_verifier: verifier,
      }),
    });
    const tokens = await responseJson<TokenResponse>(tokenResponse, "Completing login");
    await withCredentialLock(filePath, async () => {
      const credentials = await readCredentialFile(filePath);
      credentials.instances[origin] = {
        clientId: registration.client_id,
        resource,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: now() + tokens.expires_in * 1000,
      };
      await writeCredentialFile(filePath, credentials);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
