/**
 * Configuration resolution for the infracodebase MCP server.
 *
 * Auth follows the standard local-MCP-server convention (GitHub, Stripe, ...):
 * the token comes from an environment variable (or flag) supplied by the MCP
 * client's config - there is no stored config file or CLI login step.
 */

import { z } from "zod";

export const DEFAULT_API_URL = "https://infracodebase.com/api/v1";

const ConfigSchema = z.object({
  apiUrl: z.string().url().default(DEFAULT_API_URL),
  apiToken: z.string().min(1),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface ConfigOverrides {
  token?: string;
  apiUrl?: string;
}

/**
 * Resolve effective configuration from flags and environment.
 *
 * Precedence (highest first): explicit flags > environment variables > defaults.
 *   token   --token   | INFRACODEBASE_TOKEN     (required)
 *   apiUrl  --api-url  | INFRACODEBASE_API_URL  (defaults to the SaaS endpoint)
 */
export function loadConfig(overrides: ConfigOverrides = {}): Config {
  const apiToken = overrides.token ?? process.env.INFRACODEBASE_TOKEN;
  const apiUrl = overrides.apiUrl ?? process.env.INFRACODEBASE_API_URL ?? DEFAULT_API_URL;

  if (!apiToken) {
    throw new Error(
      `No infracodebase token found.\n\n` +
        `Supply it via your MCP client config (recommended):\n` +
        `  "env": { "INFRACODEBASE_TOKEN": "icb_pat_..." }\n\n` +
        `Or on the command line:\n` +
        `  infracodebase --token=icb_pat_...\n\n` +
        `Get a token: https://infracodebase.com/settings/tokens`
    );
  }

  return ConfigSchema.parse({ apiToken, apiUrl });
}
