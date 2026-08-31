import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { buildDiscoverySnapshot, handleRequest, PairingSession, validatePairingRegistration, validateRelay, WriteGuard } from "./index.js";

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

  it("allows the same prepared signature to be retried when protocol verification is temporarily unavailable", async () => {
    const originalFetch = globalThis.fetch;
    let writeGuardTouched = false;
    let upstreamPostCount = 0;
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") upstreamPostCount += 1;
      return new Response("temporarily unavailable", { status: 503 });
    };
    const writeGuard = {
      idFromName() { writeGuardTouched = true; return "guard"; },
      get() { return { fetch: async () => new Response(null, { status: 201 }) }; },
    };
    const body = JSON.stringify({ room: "dev", from: did, nonce: "1", text: "hello", sig: `${"a".repeat(85)}A` });
    try {
      const response = await handleRequest(new Request("https://guild.test/api/technocore/relay", {
        method: "POST", headers: { origin: "https://guild.test", "content-type": "application/json" }, body,
      }), {
        PUBLIC_WRITES: "true", APP_ORIGIN: "https://guild.test", WRITE_GUARD: writeGuard,
        EXPECTED_CONFIG_SHA256: "a".repeat(64), EXPECTED_OPENAPI_SHA256: "b".repeat(64), EXPECTED_LLMS_SHA256: "c".repeat(64),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ safeToRetry: true });
      expect(writeGuardTouched).toBe(false);
      expect(upstreamPostCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not offer retry when a reviewed protocol hash actually changes", async () => {
    const originalFetch = globalThis.fetch;
    let writeGuardTouched = false;
    globalThis.fetch = async () => new Response("changed protocol", { status: 200 });
    const writeGuard = {
      idFromName() { writeGuardTouched = true; return "guard"; },
      get() { return { fetch: async () => new Response(null, { status: 201 }) }; },
    };
    const body = JSON.stringify({ room: "dev", from: did, nonce: "1", text: "hello", sig: `${"a".repeat(85)}A` });
    try {
      const response = await handleRequest(new Request("https://guild.test/api/technocore/relay", {
        method: "POST", headers: { origin: "https://guild.test", "content-type": "application/json" }, body,
      }), {
        PUBLIC_WRITES: "true", APP_ORIGIN: "https://guild.test", WRITE_GUARD: writeGuard,
        EXPECTED_CONFIG_SHA256: "a".repeat(64), EXPECTED_OPENAPI_SHA256: "b".repeat(64), EXPECTED_LLMS_SHA256: "c".repeat(64),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ safeToRetry: false });
      expect(writeGuardTouched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts only the fixed relay schema", () => {
    expect(() => validateRelay({ room: "general", from: did, nonce: "1", text: "hi", sig: "a".repeat(86), prompt: "secret" })).toThrow(/unsupported/);
    expect(() => validateRelay({ room: "general", from: did, nonce: "1", text: "hi", sig: "a".repeat(86) })).toThrow(/signature/);
    expect(validateRelay({ room: "general", from: did, nonce: "1", text: "hi", sig: `${"a".repeat(85)}A` }).room).toBe("general");
  });

  it("rejects arbitrary proxy paths", async () => {
    const response = await handleRequest(new Request("https://guild.test/api/proxy?url=https://evil.test"));
    expect(response.status).toBe(404);
  });

  it("builds a bounded discovery snapshot from public data", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/rooms?")) return new Response(JSON.stringify({ rooms: [{ room: "technocore", topic: "Work" }, { room: "../bad", topic: "Ignore" }] }));
      if (url.includes("/r/technocore")) return new Response(JSON.stringify({ messages: [{ seq: 4, ts: "2026-08-30T10:00:00Z", from: "agent", text: "Need\u202e help" }] }));
      if (url.includes("/api/board")) return new Response(JSON.stringify({ jobs: [{ job_id: "k123", title: "Test docs", body: "Check one path", status: "open" }] }));
      throw new Error(`Unexpected URL ${url}`);
    };
    try {
      const snapshot = await buildDiscoverySnapshot("all");
      expect(snapshot.coverage.roomsChecked).toEqual(["technocore"]);
      expect(snapshot.conversations[0].text).toBe("Need  help");
      expect(snapshot.jobs[0]).toMatchObject({ id: "k123", title: "Test docs" });
      expect(snapshot.untrusted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the available discovery source when the other source is down", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/rooms?")) return new Response(JSON.stringify({ rooms: [{ room: "technocore" }] }));
      if (url.includes("/r/technocore")) return new Response(JSON.stringify({ messages: [{ seq: 7, from: "agent", text: "Can someone test this?" }] }));
      if (url.includes("/api/board")) throw new Error("community board unavailable");
      throw new Error(`Unexpected URL ${url}`);
    };
    try {
      const snapshot = await buildDiscoverySnapshot("all");
      expect(snapshot.conversations).toHaveLength(1);
      expect(snapshot.jobs).toEqual([]);
      expect(snapshot.coverage.note).toContain("Kibble board verification was temporarily unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps room-derived Kibble JOB signals locked when the board is down", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/rooms?")) return new Response(JSON.stringify({ rooms: [{ room: "technocore" }, { room: "kibble" }] }));
      if (url.includes("/r/kibble")) return new Response(JSON.stringify({ messages: [{ seq: 8, ts: "2026-08-30T10:00:00Z", from: did, text: "JOB v1 | k0123456789 | build | Check reconnect | Reproduce one failure" }] }));
      if (url.includes("/r/technocore")) return new Response(JSON.stringify({ messages: [] }));
      if (url.includes("/r/dev")) return new Response(JSON.stringify({ messages: [] }));
      if (url.includes("/api/board")) throw new Error("board timeout");
      throw new Error(`Unexpected URL ${url}`);
    };
    try {
      const snapshot = await buildDiscoverySnapshot("all");
      expect(snapshot.jobs[0]).toMatchObject({ id: "k0123456789", claimable: false, boardState: "room-unverified" });
      expect(snapshot.coverage.note).toContain("cannot be claimed");
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it("keeps browser commands separate from agent lifecycle events", async () => {
    const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
    const storage = new MemoryStorage();
    const session = new PairingSession({ storage });
    const sessionId = "c".repeat(32);
    const registration = { version: 2, sessionId, publicKey, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    await session.fetch(new Request("https://pairing.internal/register", { method: "POST", body: JSON.stringify(registration) }));

    const commandPath = `/api/pairing/${sessionId}/commands`;
    const body = JSON.stringify({ eventId: "mission_1234", envelope: { version: 1, eventId: "mission_1234", iv: "a".repeat(16), ciphertext: "b".repeat(40) } });
    const commandHeaders = await authHeaders(keys.privateKey, "POST", commandPath, body, "c".repeat(24));
    expect((await session.fetch(new Request(`https://guild.test${commandPath}`, { method: "POST", headers: commandHeaders, body }))).status).toBe(201);

    const eventsPath = `/api/pairing/${sessionId}/events?after=0`;
    const eventHeaders = await authHeaders(keys.privateKey, "GET", eventsPath, "", "e".repeat(24));
    const eventsResponse = await session.fetch(new Request(`https://guild.test${eventsPath}`, { headers: eventHeaders }));
    expect((await eventsResponse.json()).events).toEqual([]);

    const inboxPath = `/api/pairing/${sessionId}/commands?after=0`;
    const inboxHeaders = await authHeaders(keys.privateKey, "GET", inboxPath, "", "i".repeat(24));
    const inboxResponse = await session.fetch(new Request(`https://guild.test${inboxPath}`, { headers: inboxHeaders }));
    expect((await inboxResponse.json()).events).toHaveLength(1);
  });

  it("blocks duplicate signed writes and rate limits a DID plus room", async () => {
    const guard = new WriteGuard({ storage: new MemoryStorage() });
    const reserve = (nonce: string, digest: string) => guard.fetch(new Request("https://write-guard.internal/reserve", {
      method: "POST", body: JSON.stringify({ nonce, digest }),
    }));
    expect((await reserve("1", "a".repeat(64))).status).toBe(201);
    expect((await reserve("1", "b".repeat(64))).status).toBe(409);
    expect((await reserve("2", "b".repeat(64))).status).toBe(201);
    expect((await reserve("3", "c".repeat(64))).status).toBe(201);
    expect((await reserve("4", "d".repeat(64))).status).toBe(429);
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
