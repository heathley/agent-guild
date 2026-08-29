import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pairingPath = process.argv[2];
if (!pairingPath) throw new Error("Pass the absolute path to a fresh agent-guild-pairing.json after sending a mission from the site.");

const connector = fileURLToPath(new URL("./index.ts", import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", connector, "pair-file", pairingPath] });
const client = new Client({ name: "agent-guild-mission-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const status = await client.callTool({ name: "guild_status", arguments: {} });
  const statusText = JSON.stringify(status);
  if (status.isError || !statusText.includes('"lifecycleState":"mission.selected"') || !statusText.includes('"publicActions":"human-approval-required"')) {
    throw new Error("No fresh DID-bound mission was found in the encrypted inbox.");
  }
  const started = await client.callTool({ name: "guild_start_run", arguments: { mode: "research" } });
  if (started.isError || !JSON.stringify(started).includes('"lifecycleState":"mission.researching"')) {
    throw new Error("The connector did not report the local research lifecycle event.");
  }
  process.stdout.write("Mission handoff passed: encrypted assignment received and local research event returned; no public action.\n");
} finally {
  await transport.close();
}
