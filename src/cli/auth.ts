/**
 * `infracodebase auth <status|logout>` - inspect and clear the cached token.
 */

import {
  loadConfig,
  deleteConfig,
  maskToken,
  CONFIG_PATH,
  type ConfigOverrides,
} from "../config.js";
import { InfracodebaseClient } from "../client.js";

async function status(overrides: ConfigOverrides): Promise<void> {
  let config;
  try {
    config = await loadConfig(overrides);
  } catch {
    console.log("Not authenticated.");
    console.log("Run 'infracodebase init' to set up a token.");
    return;
  }

  console.log(`Config:  ${CONFIG_PATH}`);
  console.log(`Token:   ${maskToken(config.apiToken)}`);
  console.log(`API URL: ${config.apiUrl}`);

  const client = new InfracodebaseClient({ baseUrl: config.apiUrl, token: config.apiToken });
  try {
    const enterprises = await client.verifyToken();
    const names = enterprises.map((e) => e.name).filter(Boolean);
    console.log(
      `Status:  valid - ${enterprises.length} enterprise${
        enterprises.length === 1 ? "" : "s"
      }${names.length ? `: ${names.join(", ")}` : ""}`
    );
  } catch (error) {
    const code = (error as { status?: number }).status;
    if (code === 401 || code === 403) {
      console.log(`Status:  token rejected (HTTP ${code}) - invalid or expired`);
      console.log("Get a fresh token: https://infracodebase.com/settings/tokens");
      process.exitCode = 1;
    } else {
      console.log(`Status:  could not reach API - ${(error as Error).message}`);
      process.exitCode = 1;
    }
  }
}

async function logout(): Promise<void> {
  const removed = await deleteConfig();
  console.log(removed ? `Logged out - removed ${CONFIG_PATH}.` : "Nothing to do - no cached config found.");
}

export async function authCommand(argv: string[], overrides: ConfigOverrides): Promise<void> {
  const sub = argv[0] ?? "status";
  switch (sub) {
    case "status":
      return status(overrides);
    case "logout":
      return logout();
    default:
      console.error(`Unknown auth command: ${sub}`);
      console.error("Available: auth status, auth logout");
      process.exit(1);
  }
}
