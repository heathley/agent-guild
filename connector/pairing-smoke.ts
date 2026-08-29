import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pairingPath = process.argv[2];
if (!pairingPath) throw new Error("Pass the absolute path to agent-guild-pairing.json.");

const connector = fileURLToPath(new URL("./index.ts", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", connector, "pair-file", pairingPath],
});
const client = new Client({ name: "agent-guild-pairing-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const status = await client.callTool({ name: "guild_status", arguments: {} });
  if (status.isError || !JSON.stringify(status).includes('"delivery":"encrypted-relay"')) {
    throw new Error("The encrypted pairing event did not reach the relay.");
  }
  process.stdout.write("Pairing smoke passed: one DID-bound encrypted agent.connected event, no public message.\n");
} finally {
  await transport.close();
}
