import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const connector = fileURLToPath(new URL("./index.ts", import.meta.url));
const token = `agp_${"b".repeat(43)}`;
const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", connector, "pair", token] });
const client = new Client({ name: "agent-guild-generic-mcp-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  const expected = [
    "guild_attach_evidence", "guild_propose_mission", "guild_report_progress", "guild_request_public_action",
    "guild_request_review", "guild_scan_work", "guild_start_run", "guild_status", "guild_suggest_work",
  ].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`Unexpected MCP tools: ${names.join(", ")}`);
  const status = await client.callTool({ name: "guild_status", arguments: {} });
  if (status.isError || !JSON.stringify(status).includes("sessionId")) throw new Error("guild_status smoke call failed.");
  process.stdout.write(`Generic MCP smoke passed: ${names.length} narrow tools, no post_message.\n`);
} finally {
  await transport.close();
}
