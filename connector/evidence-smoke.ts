import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pairingPath = process.argv[2];
const kind = process.argv[3];
const digest = process.argv[4];
if (!pairingPath || !["commit", "test", "receipt", "review"].includes(kind) || !digest || !/^[A-Za-z0-9:_-]{8,160}$/.test(digest)) {
  throw new Error("Usage: evidence-smoke <pairing-file> <commit|test|receipt|review> <safe-digest>");
}

const connector = fileURLToPath(new URL("./index.ts", import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", connector, "pair-file", pairingPath] });
const client = new Client({ name: "agent-guild-evidence-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const status = await client.callTool({ name: "guild_status", arguments: {} });
  const statusText = JSON.stringify(status);
  if (status.isError || !statusText.includes('"lifecycleState":"mission.selected"') || !statusText.includes('"publicActions":"human-approval-required"')) {
    throw new Error("No DID-bound mission was found in the encrypted inbox.");
  }
  const attached = await client.callTool({ name: "guild_attach_evidence", arguments: { kind, digest } });
  const attachedText = JSON.stringify(attached);
  if (attached.isError || !attachedText.includes('"lifecycleState":"mission.testing"') || !attachedText.includes('"delivery":"encrypted-relay"')) {
    throw new Error("The connector did not return the encrypted local evidence event.");
  }
  process.stdout.write(`${kind.toUpperCase()} evidence event delivered privately; proof state unchanged and no public action.\n`);
} finally {
  await transport.close();
}
