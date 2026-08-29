import { BRIDGE_VERSION, type AgentBridgeEvent } from "../src/bridge/contract.js";
import {
  createRelayPairing, decryptRelayedEvent, pollRelayEvents,
} from "../src/bridge/pairing.js";
import { encryptRelayedConnectorEvent, relayConnectorEvent } from "./crypto.js";

const relayUrl = process.env.AGENT_GUILD_EDGE;
const appOrigin = process.env.AGENT_GUILD_APP_ORIGIN;
if (!relayUrl || !appOrigin) throw new Error("Set AGENT_GUILD_EDGE and AGENT_GUILD_APP_ORIGIN for the relay smoke test.");

const pairing = await createRelayPairing(relayUrl);
const registration = await fetch(`${pairing.relayUrl}/api/pairing/session`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: appOrigin },
  body: JSON.stringify({
    version: pairing.version,
    sessionId: pairing.sessionId,
    publicKey: pairing.signingPublicKey,
    expiresAt: pairing.expiresAt,
  }),
});
if (!registration.ok) throw new Error(`Pairing registration failed (${registration.status}).`);

const event: AgentBridgeEvent = {
  version: BRIDGE_VERSION,
  eventId: crypto.randomUUID(),
  occurredAt: new Date().toISOString(),
  event: "agent.connected",
  source: { adapter: "relay-smoke", agentLabel: "ephemeral-test-client" },
  identity: { did: null },
  detail: "Encrypted relay acceptance test. Not a contribution or public message.",
};
const encrypted = await encryptRelayedConnectorEvent(pairing, event);
const seq = await relayConnectorEvent(pairing, event.eventId, encrypted);
const relayed = await pollRelayEvents(pairing, 0);
const received = relayed.find((item) => item.seq === seq);
if (!received) throw new Error("Encrypted event was not returned by the relay.");
const decrypted = await decryptRelayedEvent(pairing, received.envelope);
if (decrypted.eventId !== event.eventId || decrypted.event !== "agent.connected") throw new Error("Encrypted relay round-trip did not match.");

process.stdout.write("Encrypted relay smoke passed: one ephemeral session, one ciphertext event, no DID or public message.\n");
