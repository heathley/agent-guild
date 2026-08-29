import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { handleRequest, PairingSession, validatePairingRegistration, validateRelay } from "./index.js";

const did = "did:key:z6Mk11111111111111111111111111111111111111111111";

describe("edge worker", () => {
  it("keeps public writes disabled by default", async () => {
    const response = await handleRequest(new Request("https://guild.test/api/technocore/relay", { method: "POST" }));
    expect(response.status).toBe(403);
  });

  it("keeps writes locked when reviewed protocol hashes are not configured", async () => {
    const response = await handleRequest(new Request("https://guild.test/api/technocore/relay", { method: "POST", headers: { origin: "https://guild.test" } }), { PUBLIC_WRITES: "true", APP_ORIGIN: "https://guild.test" });
    expect(response.status).toBe(409);
  });

  it("accepts only the fixed relay schema", () => {
    expect(() => validateRelay({ room: "general", from: did, nonce: "1", text: "hi", sig: "a".repeat(86), prompt: "secret" })).toThrow(/unsupported/);
    expect(validateRelay({ room: "general", from: did, nonce: "1", text: "hi", sig: "a".repeat(86) }).room).toBe("general");
  });

  it("rejects arbitrary proxy paths", async () => {
    const response = await handleRequest(new Request("https://guild.test/api/proxy?url=https://evil.test"));
    expect(response.status).toBe(404);
  });

  it("accepts only public P-256 registration material", () => {
    const registration = { version: 2, sessionId: "a".repeat(32), expiresAt: new Date(Date.now() + 60_000).toISOString(), publicKey: { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) } };
    expect(validatePairingRegistration(registration).publicKey).not.toHaveProperty("d");
    expect(() => validatePairingRegistration({ ...registration, publicKey: { ...registration.publicKey, d: "secret" } })).toThrow(/public key/);
  });

  it("stores only authenticated encrypted events and rejects replay", async () => {
    const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
    const storage = new MemoryStorage();
    const session = new PairingSession({ storage });
    const sessionId = "s".repeat(32);
    const registration = { version: 2, sessionId, publicKey, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    expect((await session.fetch(new Request("https://pairing.internal/register", { method: "POST", body: JSON.stringify(registration) }))).status).toBe(201);

    const path = `/api/pairing/${sessionId}/events`;
    const body = JSON.stringify({ eventId: "event_1234", envelope: { version: 1, eventId: "event_1234", iv: "a".repeat(16), ciphertext: "b".repeat(40) } });
    const headers = await authHeaders(keys.privateKey, "POST", path, body, "n".repeat(24));
    const request = new Request(`https://guild.test${path}`, { method: "POST", headers, body });
    expect((await session.fetch(request.clone())).status).toBe(201);
    expect((await session.fetch(request.clone())).status).toBe(401);
    expect(JSON.stringify(await storage.get("events"))).not.toContain("signingPrivateKey");
  });
});

class MemoryStorage {
  values = new Map<string, unknown>();
  async get(key: string) { return this.values.get(key); }
  async put(key: string, value: unknown) { this.values.set(key, value); }
  async setAlarm(_timestamp: number) {}
  async deleteAll() { this.values.clear(); }
}

async function authHeaders(privateKey: CryptoKey, method: string, path: string, body: string, nonce: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${hash}`;
  const signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(canonical));
  return { "x-ag-timestamp": timestamp, "x-ag-nonce": nonce, "x-ag-signature": Buffer.from(signature).toString("base64url") };
}
