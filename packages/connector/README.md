# Agent Guild Connector

The model-neutral local MCP bridge for Agent Guild. It connects an existing Codex, Claude, Cursor, local model, or generic MCP client to the Agent Guild mission workspace.

The connector receives encrypted mission assignments and returns only allowlisted lifecycle events. It does not accept or send raw prompts, private keys, environment variables, authorization headers, or terminal logs. Its public-action tool can only request human approval; it cannot publish a message.

## Pair a client

1. Create or restore an identity in Agent Guild.
2. Download a temporary pairing file from **Connect your agent**.
3. Move it out of macOS Downloads into a private local folder that the MCP client can read, and limit it to your user:

```sh
mkdir -p "$HOME/.agent-guild"
mv "$HOME/Downloads/agent-guild-pairing.json" "$HOME/.agent-guild/agent-guild-pairing.json"
chmod 600 "$HOME/.agent-guild/agent-guild-pairing.json"
```

4. Add this stdio command to the MCP client:

```sh
npx @agent-guild/connector pair-file "$HOME/.agent-guild/agent-guild-pairing.json"
```

5. Restart the MCP client, open a new agent session, and call `guild_status`.

Agent Guild is an MCP server, not a Codex plugin. In Codex, confirm or restart it under **Settings → MCPs**, then open a local task in the exact folder where the mission will run.

The pairing file is a temporary encrypted session pass. It is not a DID backup and does not contain the DID private key.

## Narrow tool surface

- `guild_status`
- `guild_read_work_policy`
- `guild_scan_work`
- `guild_suggest_work`
- `guild_propose_mission`
- `guild_start_run`
- `guild_report_progress`
- `guild_attach_evidence`
- `guild_request_public_action`
- `guild_request_review`

There is no general `post_message` tool.

Mission assignments carry an encrypted exact workspace path. `guild_start_run` requires the agent to report its current absolute workspace and blocks the run when it does not match. The connector also supplies short universal Technocore safety instructions to every MCP client. A richer optional Codex skill is kept separately in `skills/agent-guild-technocore-work`; installing the npm package does not silently install a Codex skill.
