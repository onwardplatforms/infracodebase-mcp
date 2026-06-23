#!/usr/bin/env node
/**
 * Offline MCP smoke test.
 *
 * Spawns the built server, performs the initialize handshake, and asserts that
 * tools/list returns the full tool set. Touches no network and needs no token,
 * so it's safe to run anywhere (including CI). Exits non-zero on any failure.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const EXPECTED_TOOL_COUNT = 14;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "dist", "index.js");

const requests = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
];

const child = spawn("node", [entry], { stdio: ["pipe", "pipe", "inherit"] });

let out = "";
child.stdout.on("data", (chunk) => {
  out += chunk;
});

child.on("error", (err) => {
  console.error(`✗ failed to spawn ${entry}: ${err.message}`);
  console.error("  Did you run `pnpm build` first?");
  process.exit(1);
});

child.on("close", () => {
  const messages = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const init = messages.find((m) => m.id === 1);
  const list = messages.find((m) => m.id === 2);
  const failures = [];

  if (!init?.result?.serverInfo) {
    failures.push("initialize did not return serverInfo");
  } else {
    console.log(`✓ initialize → ${init.result.serverInfo.name} ${init.result.serverInfo.version}`);
  }

  const tools = list?.result?.tools;
  if (!Array.isArray(tools)) {
    failures.push("tools/list did not return a tools array");
  } else {
    console.log(`✓ tools/list → ${tools.length} tools`);
    if (tools.length !== EXPECTED_TOOL_COUNT) {
      failures.push(`expected ${EXPECTED_TOOL_COUNT} tools, got ${tools.length}`);
    }
  }

  if (failures.length) {
    console.error("\n✗ smoke test failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n✓ smoke test passed");
});

child.stdin.write(requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
child.stdin.end();
