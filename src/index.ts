#!/usr/bin/env node

/**
 * CLI entry point for @infracodebase/mcp
 *
 * Usage:
 *   infracodebase                  Start the MCP server (stdio transport)
 *   infracodebase init             Validate token, write config, print install steps
 *   infracodebase auth status      Show the cached token and what it can access
 *   infracodebase auth logout      Remove the cached config
 *   infracodebase help             Show usage
 *
 * Flags (also work as INFRACODEBASE_TOKEN / INFRACODEBASE_API_URL env vars):
 *   --token=<token>   --api-url=<url>
 */

import { loadConfig, initializeSetup, type ConfigOverrides } from "./config.js";
import { startServer } from "./server.js";
import { authCommand } from "./cli/auth.js";
import { configCommand } from "./cli/config.js";
import { buildUsage } from "./cli/usage.js";

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
  const command = argv.find((a) => !a.startsWith("-"));

  const overrides: ConfigOverrides = {
    token: readFlag(argv, "token"),
    apiUrl: readFlag(argv, "api-url"),
  };

  // Help is also accepted as a flag (--help / -h), not just a command.
  if (command === "help" || argv.includes("--help") || argv.includes("-h")) {
    console.log(buildUsage());
    return;
  }

  try {
    switch (command) {
      case "init":
      case "configure": // backwards-compatible alias
        await initializeSetup(overrides);
        return;

      case "auth":
        await authCommand(argv.slice(argv.indexOf("auth") + 1), overrides);
        return;

      case "config":
        await configCommand(argv.slice(argv.indexOf("config") + 1));
        return;

      case undefined:
      case "start": {
        const config = await loadConfig(overrides);
        await startServer(config);
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
