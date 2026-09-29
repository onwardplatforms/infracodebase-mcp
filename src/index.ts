#!/usr/bin/env node

/**
 * CLI entry point for @infracodebase/mcp
 *
 * Usage:
 *   infracodebase            Start the MCP server (stdio transport, default)
 *   infracodebase login      Sign in through the browser
 *   infracodebase logout     Remove the saved session for this instance
 *   infracodebase help       Show usage
 *
 * Auth comes from env vars (or flags), supplied by your MCP client's config:
 *   INFRACODEBASE_TOKEN    / --token=<token>     (required)
 *   INFRACODEBASE_API_URL  / --api-url=<url>     (optional; defaults to SaaS)
 */

import { loadConfig, type ConfigOverrides } from "./config.js";
import { InfracodebaseClient } from "./client.js";
import { startServer } from "./server.js";
import { buildUsage } from "./cli/usage.js";
import { login, logout } from "./oauth.js";

/** Read `--name=value` or `--name value` from argv, returning undefined if absent. */
function readFlag(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${name}`) return argv[i + 1];
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : undefined;

  // Help is also accepted as a flag (--help / -h), not just a command.
  if (command === "help" || argv.includes("--help") || argv.includes("-h")) {
    console.log(buildUsage());
    return;
  }

  const overrides: ConfigOverrides = {
    token: readFlag(argv, "token"),
    apiUrl: readFlag(argv, "api-url"),
  };

  try {
    switch (command) {
      case undefined:
      case "start": {
        const config = loadConfig(overrides);
        await startServer(config);
        return;
      }

      case "login": {
        const config = loadConfig({ apiUrl: overrides.apiUrl });
        const noOpen = argv.includes("--no-open");
        await login(config.apiUrl, {
          openBrowser: noOpen
            ? async (url) => {
                console.error(`Open this URL to continue:\n${url}`);
              }
            : undefined,
        });
        const me = await new InfracodebaseClient({
          baseUrl: config.apiUrl,
          getAccessToken: config.getAccessToken,
        }).verifyToken();
        console.error(`Signed in${me.email ? ` as ${me.email}` : ""}.`);
        return;
      }

      case "logout": {
        const config = loadConfig({ apiUrl: overrides.apiUrl });
        const removed = await logout(config.apiUrl);
        console.error(removed ? "Signed out." : "No saved login was found.");
        return;
      }

      default:
        console.error(`Unknown command: ${command}\n`);
        console.error(buildUsage());
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
