import { describe, expect, it, vi } from "vitest";
import { decryptRelayedMission, encryptConnectorEvent, encryptRelayedConnectorEvent } from "../../connector/crypto.js";
import { ASSIGNMENT_VERSION, BRIDGE_VERSION } from "./contract";
import { createRelayPairing, decryptConnectorEvent, decryptRelayedEvent, exportRelayPairing, pairingFileName, pairingSessionId, parseRelayPairing, relayPollDelay, sendRelayAssignment } from "./pairing";

const token = `agp_${"a".repeat(43)}`;
const agentDid = `did:key:z6Mk${"a".repeat(44)}`;
const event = { version: BRIDGE_VERSION, eventId: "evt_pair", occurredAt: "2026-08-29T00:00:00.000Z", event: "mission.testing" as const, source: { adapter: "mcp", agentLabel: "test" }, identity: { did: null } };

describe("browser pairing", () => {
  it("keeps relay polling inside the free-tier request budget", () => {
    expect(relayPollDelay("visible")).toBe(30_000);
    expect(relayPollDelay("visible", true)).toBe(5_000);
    expect(relayPollDelay("visible", false, true)).toBe(60_000);
    expect(relayPollDelay("hidden")).toBe(300_000);
  });

  it("uses a short session-bound filename so repeated downloads do not collide", () => {
    expect(pairingFileName("AbCdEfGh1234567890_-abcdefghijkl")).toBe("agent-guild-pairing-AbCdEfGh.json");
    expect(() => pairingFileName("../../pairing")).toThrow(/session id/);
  });

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

  it("restores only a current pairing for the same DID and relay", async () => {
    const pairing = await createRelayPairing("https://guild.test", agentDid);
    const serialized = exportRelayPairing(pairing);
    expect(parseRelayPairing(serialized, "https://guild.test", agentDid)).toEqual(pairing);
    expect(() => parseRelayPairing(serialized, "https://other.test", agentDid)).toThrow(/different relay/);
    expect(() => parseRelayPairing(serialized, "https://guild.test", `did:key:z6Mk${"b".repeat(44)}`)).toThrow(/different agent DID/);
    expect(() => parseRelayPairing(JSON.stringify({ ...pairing, prompt: "not allowed" }), "https://guild.test", agentDid)).toThrow(/unsupported fields/);
    expect(() => parseRelayPairing(JSON.stringify({ ...pairing, signingPublicKey: { ...pairing.signingPublicKey, prompt: "not allowed" } }), "https://guild.test", agentDid)).toThrow(/signing keys/);
  });

  it("encrypts a DID-bound mission that the connector can decrypt", async () => {
    const pairing = await createRelayPairing("https://guild.test", agentDid);
    let posted: { eventId: string; envelope: { version: 1; eventId: string; iv: string; ciphertext: string } } | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      posted = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ accepted: true, seq: 1 }), { status: 201, headers: { "content-type": "application/json" } });
    });
    const now = Date.now();
    const assignment = {
      version: ASSIGNMENT_VERSION, assignmentId: "assignment_1234",
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), agentDid,
      mission: { id: "local:1", source: "local", title: "Connector check", summary: "Receive one safe mission.", successCriteria: ["Agent acknowledges it"], verification: "Observe lifecycle events.", risk: "low", prompt: "not allowed" },
      workspace: { requiredPath: "/Users/test/Flop-Friend", policy: "exact" },
      publicActions: "human-approval-required",
    };
    try {
      await expect(sendRelayAssignment(pairing, assignment)).resolves.toBe(1);
      expect(JSON.stringify(posted)).not.toContain("Connector check");
      const decrypted = await decryptRelayedMission(pairing, { seq: 1, envelope: posted!.envelope });
      expect(decrypted.mission.title).toBe("Connector check");
      expect(decrypted.mission).not.toHaveProperty("prompt");
      expect(decrypted.workspace.requiredPath).toBe("/Users/test/Flop-Friend");
    } finally {
      fetchMock.mockRestore();
    }
  });
});
