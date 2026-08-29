import { describe, expect, it } from "vitest";
import { encryptConnectorEvent, encryptRelayedConnectorEvent } from "../../connector/crypto.js";
import { BRIDGE_VERSION } from "./contract";
import { createRelayPairing, decryptConnectorEvent, decryptRelayedEvent, pairingSessionId } from "./pairing";

const token = `agp_${"a".repeat(43)}`;
const agentDid = `did:key:z6Mk${"a".repeat(44)}`;
const event = { version: BRIDGE_VERSION, eventId: "evt_pair", occurredAt: "2026-08-29T00:00:00.000Z", event: "mission.testing" as const, source: { adapter: "mcp", agentLabel: "test" }, identity: { did: null } };

describe("browser pairing", () => {
  it("shares session ids and decrypts only allowlisted events", async () => {
    expect(await pairingSessionId(token)).toHaveLength(32);
    const encrypted = await encryptConnectorEvent(token, event);
    await expect(decryptConnectorEvent(token, { ...encrypted, eventId: event.eventId })).resolves.toEqual(event);
  });

  it("keeps relay encryption secrets out of the encrypted envelope", async () => {
    const pairing = await createRelayPairing("https://guild.test", agentDid);
    expect(pairing.agentDid).toBe(agentDid);
    const encrypted = await encryptRelayedConnectorEvent(pairing, event);
    expect(JSON.stringify(encrypted)).not.toContain(pairing.encryptionKey);
    await expect(decryptRelayedEvent(pairing, { ...encrypted, eventId: event.eventId })).resolves.toEqual(event);
  });
});
