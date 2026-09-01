import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = new URL("../packages/connector/dist/connector/index.js", import.meta.url);
await access(entry, constants.R_OK);
const source = await readFile(entry, "utf8");
if (!source.startsWith("#!/usr/bin/env node")) throw new Error("Connector package entry lost its executable shebang.");
if (!source.includes("guild_request_public_action") || !source.includes("guild_suggest_work") || !source.includes("guild_read_work_policy") || !source.includes("guild_offer_workspace") || source.includes('registerTool("post_message"')) throw new Error("Connector tool surface is unsafe or incomplete.");
const token = `agp_${"c".repeat(43)}`;
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(entry), "pair", token] });
const client = new Client({ name: "agent-guild-packed-connector-smoke", version: "1.0.0" });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  if (names.length !== 11 || names.includes("post_message")) throw new Error(`Unexpected packaged MCP tools: ${names.join(", ")}`);
  const status = await client.callTool({ name: "guild_status", arguments: {} });
  if (status.isError) throw new Error("Packaged guild_status call failed.");
} finally {
  await transport.close();
}
process.stdout.write("Connector package smoke passed: built entry starts, exposes 11 narrow tools, and answers guild_status.\n");
