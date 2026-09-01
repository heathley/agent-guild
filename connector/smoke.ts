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
    "guild_attach_evidence", "guild_propose_mission", "guild_read_work_policy", "guild_report_progress", "guild_request_public_action",
    "guild_offer_workspace", "guild_request_review", "guild_scan_work", "guild_start_run", "guild_status", "guild_suggest_work",
  ].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`Unexpected MCP tools: ${names.join(", ")}`);
  const status = await client.callTool({ name: "guild_status", arguments: {} });
  if (status.isError || !JSON.stringify(status).includes("sessionId")) throw new Error("guild_status smoke call failed.");
  const policy = await client.callTool({ name: "guild_read_work_policy", arguments: {} });
  if (policy.isError || !JSON.stringify(policy).includes("human-approval-required")) throw new Error("guild_read_work_policy smoke call failed.");
  const workspaceOffer = await client.callTool({ name: "guild_offer_workspace", arguments: { workingDirectory: "/tmp/agent-guild-expected/" } });
  if (workspaceOffer.isError || !JSON.stringify(workspaceOffer).includes('"confirmed":false') || !JSON.stringify(workspaceOffer).includes('"name":"agent-guild-expected"')) throw new Error("Workspace offer smoke call failed.");
  const orphanResult = await client.callTool({ name: "guild_request_public_action", arguments: {
    kind: "result", room: "d-agent-guild", exactText: "This result must not be delivered without a selected mission.",
  } });
  if (!orphanResult.isError || !JSON.stringify(orphanResult).includes("Select or receive a mission")) throw new Error("Missionless result draft was not blocked.");
  const proposed = await client.callTool({ name: "guild_propose_mission", arguments: {
    id: "smoke:workspace", title: "Workspace guard", outcome: "Prove that a mission cannot start in the wrong project.",
    success: "A wrong path is blocked and the exact path starts locally.", source: "local", risk: "low", workspace: "/tmp/agent-guild-expected",
  } });
  if (proposed.isError) throw new Error("Workspace-locked mission proposal failed.");
  const missionResult = await client.callTool({ name: "guild_request_public_action", arguments: {
    kind: "result", room: "d-agent-guild", exactText: "This result belongs to the selected workspace mission.",
  } });
  if (missionResult.isError || !JSON.stringify(missionResult).includes('"summary":"Prove that a mission cannot start in the wrong project."')) throw new Error("Selected mission was not preserved on the result draft.");
  const blocked = await client.callTool({ name: "guild_start_run", arguments: { mode: "test", workingDirectory: "/tmp/wrong-project" } });
  if (!blocked.isError || !JSON.stringify(blocked).includes("Workspace mismatch")) throw new Error("Wrong workspace was not blocked.");
  const started = await client.callTool({ name: "guild_start_run", arguments: { mode: "test", workingDirectory: "/tmp/agent-guild-expected" } });
  if (started.isError || !JSON.stringify(started).includes('"matches":true')) throw new Error("Exact workspace did not start.");
  process.stdout.write(`Generic MCP smoke passed: ${names.length} narrow tools, no post_message.\n`);
} finally {
  await transport.close();
}
