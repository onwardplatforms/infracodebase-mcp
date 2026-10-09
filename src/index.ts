#!/usr/bin/env node

/**
 * CLI entry point for @infracodebase/mcp
 *
 * Usage:
 *   infracodebase            In a terminal: same as `init`. Launched by an MCP
 *                            client (stdio piped): start the MCP server
 *   infracodebase init       Sign in and set up your MCP clients
 *   infracodebase start      Always start the MCP server
 *   infracodebase login      Sign in through the browser
 *   infracodebase logout     Remove the saved session for this instance
 *   infracodebase help       Show usage
 *
 * Browser login is the default. Environment variables and flags are optional:
 *   INFRACODEBASE_API_URL  / --api-url=<url>     (optional; defaults to SaaS)
 *   INFRACODEBASE_TOKEN    / --token=<token>     (legacy non-interactive override)
 */

import { loadConfig, type ConfigOverrides } from "./config.js";
import { InfracodebaseClient } from "./client.js";
import { startServer } from "./server.js";
import { buildUsage } from "./cli/usage.js";
import { createStoredOAuthTokenProvider, login, logout } from "./oauth.js";
import { runInit } from "./setup/init.js";

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

  // MCP clients always launch the server with piped stdio, so a bare command
  // typed into a terminal is a person who wants to get set up.
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const effectiveCommand =
    command === undefined && interactive && !overrides.token ? "init" : command;
  const noOpen = argv.includes("--no-open");

  try {
    switch (effectiveCommand) {
      case undefined:
      case "start": {
        const config = loadConfig(overrides);
        await startServer(config);
        return;
      }

      case "init": {
        const config = loadConfig({ apiUrl: overrides.apiUrl });
        const clientFlag = readFlag(argv, "client");
        await runInit({
          apiUrl: config.apiUrl,
          noOpen,
          clientIds: clientFlag
            ?.split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        });
        return;
      }

      case "login": {
        const config = loadConfig({ apiUrl: overrides.apiUrl });
        await login(config.apiUrl, {
          onAuthorizationUrl: (url) => console.error(`Open this URL to continue:\n${url}`),
          openBrowser: noOpen ? async () => undefined : undefined,
        });
        const me = await new InfracodebaseClient({
          baseUrl: config.apiUrl,
          getAccessToken: createStoredOAuthTokenProvider(config.apiUrl),
          authKind: "oauth",
        }).verifyToken();
        console.error(`Signed in${me.email ? ` as ${me.email}` : ""}.`);
        if (process.env.INFRACODEBASE_TOKEN) {
          console.error(
            "Warning: INFRACODEBASE_TOKEN is still set and overrides this login. Remove it from your MCP client configuration to use browser login."
          );
        }
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
