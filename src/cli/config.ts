/**
 * `infracodebase config <set-url>` — edit persisted settings without re-running
 * the full setup wizard.
 */

import { loadConfig, updateConfig, maskToken, CONFIG_PATH, type Config, type ConfigPatch } from "../config.js";
import { InfracodebaseClient } from "../client.js";

/** Keys that `config set` accepts (token is set via `init`, not here). */
const SETTABLE = ["api-url"];

/** Readable config keys → how to render each value (token is masked). */
const GETTERS: Record<string, (c: Config) => string> = {
  "api-url": (c) => c.apiUrl,
  token: (c) => maskToken(c.apiToken),
};

async function get(key: string | undefined): Promise<void> {
  let config: Config;
  try {
    config = await loadConfig();
  } catch {
    console.error("Not configured. Run 'infracodebase init' first.");
    process.exit(1);
  }

  // No key: dump everything (git/npm `config list` style).
  if (!key) {
    console.log(`# ${CONFIG_PATH}`);
    for (const k of Object.keys(GETTERS)) console.log(`${k}=${GETTERS[k](config)}`);
    return;
  }

  const getter = GETTERS[key];
  if (!getter) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Available keys: ${Object.keys(GETTERS).join(", ")}`);
    process.exit(1);
  }
  console.log(getter(config));
}

/** Parse a CLI value for a key into a config patch, or exit with a clear error. */
function patchFor(key: string, value: string): ConfigPatch {
  switch (key) {
    case "api-url":
      try {
        new URL(value);
      } catch {
        console.error(`Not a valid URL: ${value}`);
        process.exit(1);
      }
      return { apiUrl: value };
    case "token":
      console.error("Refusing to set the token here. Use 'infracodebase init' (it validates the token).");
      process.exit(1);
    default:
      console.error(`Unknown or read-only config key: ${key}`);
      console.error(`Settable keys: ${SETTABLE.join(", ")}`);
      process.exit(1);
  }
}

async function set(key: string | undefined, value: string | undefined): Promise<void> {
  if (!key || value === undefined) {
    console.error("Usage: infracodebase config set <key> <value>");
    console.error(`Settable keys: ${SETTABLE.join(", ")}`);
    process.exit(1);
  }

  const patch = patchFor(key, value);

  let config: Config;
  try {
    config = await updateConfig(patch);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }

  console.log(`${key} set to ${value}`);
  console.log(`Saved to ${CONFIG_PATH}`);

  // After changing the URL, confirm the new endpoint is reachable and authorized.
  if (key === "api-url") {
    const client = new InfracodebaseClient({ baseUrl: config.apiUrl, token: config.apiToken });
    try {
      await client.verifyToken();
      console.log("Reachable - token validates against the new URL.");
    } catch (error) {
      const code = (error as { status?: number }).status;
      if (code === 401 || code === 403) {
        console.log(`Warning: reached the URL but token was rejected (HTTP ${code}).`);
      } else {
        console.log(`Warning: still could not reach it - ${(error as Error).message}`);
      }
      process.exitCode = 1;
    }
  }
}

export async function configCommand(argv: string[]): Promise<void> {
  const sub = argv[0];
  switch (sub) {
    case "get":
      return get(argv[1]);
    case "set":
      return set(argv[1], argv[2]);
    default:
      console.error(sub ? `Unknown config command: ${sub}` : "Missing config command.");
      console.error("Available: config get [key], config set <key> <value>");
      process.exit(1);
  }
}
