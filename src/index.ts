#!/usr/bin/env node

/**
 * CLI entry point for @infracodebase/mcp
 *
 * Usage:
 *   infracodebase            Start the MCP server (stdio transport, default)
 *   infracodebase help       Show usage
 *
 * Auth comes from env vars (or flags), supplied by your MCP client's config:
 *   INFRACODEBASE_TOKEN    / --token=<token>     (required)
 *   INFRACODEBASE_API_URL  / --api-url=<url>     (optional; defaults to SaaS)
 */

import { loadConfig, type ConfigOverrides } from "./config.js";
import { startServer } from "./server.js";
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
