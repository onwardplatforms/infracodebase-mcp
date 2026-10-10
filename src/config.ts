/** Configuration resolution for the infracodebase MCP server. */

import { z } from "zod";
import { createStoredOAuthTokenProvider, type AccessTokenProvider } from "./oauth.js";

export const DEFAULT_API_URL = "https://infracodebase.com/api/v1";

const ApiUrlSchema = z.string().url();

export interface Config {
  apiUrl: string;
  getAccessToken: AccessTokenProvider;
  authKind: "oauth" | "legacy_token";
}

export interface ConfigOverrides {
  token?: string;
  apiUrl?: string;
}

/**
 * Resolve effective configuration from flags and environment.
 *
 * OAuth credentials created by `infracodebase login` are the default. The
 * token flag and environment variable remain as a compatibility override for
 * existing automation and non-interactive environments.
 */
export function loadConfig(overrides: ConfigOverrides = {}): Config {
  const apiUrl = ApiUrlSchema.parse(
    overrides.apiUrl ?? process.env.INFRACODEBASE_API_URL ?? DEFAULT_API_URL
  ).replace(/\/$/, "");
  const legacyToken = overrides.token ?? process.env.INFRACODEBASE_TOKEN;

  if (legacyToken) {
    return {
      apiUrl,
      getAccessToken: async () => legacyToken,
      authKind: "legacy_token",
    };
  }

  return {
    apiUrl,
    getAccessToken: createStoredOAuthTokenProvider(apiUrl),
    authKind: "oauth",
  };
}
