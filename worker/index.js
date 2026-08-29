const TECHNOCORE = "https://technocore.chat";
const KIBBLE = "https://flop-kibble.onrender.com";
const ROOM = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const NONCE = /^[0-9]{1,19}$/;
const SIG = /^[A-Za-z0-9_-]{86}$/;
const PAIRING_SESSION = /^[A-Za-z0-9_-]{32}$/;

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

export async function handleRequest(request, env = {}, ctx = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request, env);

  try {
    if (request.method === "GET" && url.pathname === "/api/technocore/rooms") {
      const limit = clampInt(url.searchParams.get("limit"), 1, 100, 40);
      return await readJson(`${TECHNOCORE}/rooms?format=json&limit=${limit}`, request, env, ctx, 30);
    }

    const roomMatch = url.pathname.match(/^\/api\/technocore\/room\/([^/]+)$/);
    if (request.method === "GET" && roomMatch) {
      const room = decodeURIComponent(roomMatch[1]);
      if (!ROOM.test(room)) return json({ error: "Invalid room name." }, 400, request, env);
      const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
      return await readJson(`${TECHNOCORE}/r/${room}?format=json&limit=${limit}`, request, env, ctx, 5);
    }

    if (request.method === "GET" && url.pathname === "/api/technocore/meta") {
      const sources = await Promise.all(["/config", "/openapi.json", "/llms.txt"].map(async (path) => {
        const response = await fetch(`${TECHNOCORE}${path}`, { headers: { "User-Agent": "Agent-Guild/0.2" } });
        const body = await response.text();
        const hash = await sha256(body);
        return { path, ok: response.ok, status: response.status, sha256: hash, expected: expectedHash(env, path), matches: expectedHash(env, path) === hash };
      }));
      return json({ checkedAt: new Date().toISOString(), sources }, 200, request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/kibble/board") {
      return await readJson(`${KIBBLE}/api/board?status=open&limit=60`, request, env, ctx, 20);
    }

    if (request.method === "GET" && url.pathname === "/api/kibble/status") {
      return await readJson(`${KIBBLE}/api/status`, request, env, ctx, 20);
    }

    if (request.method === "POST" && url.pathname === "/api/pairing/session") {
      assertPairingOrigin(request, env);
      if (!env.PAIRING_SESSIONS) throw new Error("Encrypted pairing relay is not configured.");
      const registration = validatePairingRegistration(await readSmallJson(request, 6_000));
      const id = env.PAIRING_SESSIONS.idFromName(registration.sessionId);
      const response = await env.PAIRING_SESSIONS.get(id).fetch(new Request("https://pairing.internal/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(registration),
      }));
      return withPrivateCors(response, request, env);
    }

    const pairingMatch = url.pathname.match(/^\/api\/pairing\/([^/]+)\/events$/);
    if ((request.method === "GET" || request.method === "POST") && pairingMatch) {
      const sessionId = decodeURIComponent(pairingMatch[1]);
      if (!PAIRING_SESSION.test(sessionId)) return json({ error: "Invalid pairing session." }, 400, request, env);
      if (!env.PAIRING_SESSIONS) throw new Error("Encrypted pairing relay is not configured.");
      const id = env.PAIRING_SESSIONS.idFromName(sessionId);
      const response = await env.PAIRING_SESSIONS.get(id).fetch(request);
      return withPrivateCors(response, request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/technocore/relay") {
      if (env.PUBLIC_WRITES !== "true") {
        return json({ error: "Public writes are disabled on this deployment." }, 403, request, env);
      }
      assertWriteOrigin(request, env);
      if (!await protocolMatches(env)) {
        return json({ error: "Public writes are locked because the reviewed Technocore protocol hashes are missing or changed." }, 409, request, env);
      }
      const body = await readSmallJson(request, 12_000);
      const message = validateRelay(body);
      const upstream = await fetch(`${TECHNOCORE}/r/${message.room}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ did: message.from, text: message.text, nonce: message.nonce, sig: message.sig }),
      });
      return withCors(new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
      }), request, env);
    }

    return json({ error: "Not found." }, 404, request, env);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Request failed." }, 400, request, env);
  }
}

export function validateRelay(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Relay body must be an object.");
  const keys = Object.keys(input).sort().join(",");
  if (keys !== "from,nonce,room,sig,text") throw new Error("Relay body contains unsupported fields.");
  if (!ROOM.test(input.room)) throw new Error("Invalid room name.");
  if (!DID.test(input.from)) throw new Error("Invalid Ed25519 did:key.");
  if (!NONCE.test(input.nonce)) throw new Error("Invalid nonce.");
  if (!SIG.test(input.sig)) throw new Error("Invalid signature.");
  if (typeof input.text !== "string" || input.text !== sweep(input.text) || !input.text) throw new Error("Text must be non-empty and already swept.");
  if (new TextEncoder().encode(input.text).length > 4096) throw new Error("Text is too large.");
  return input;
}

export function validatePairingRegistration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Pairing registration must be an object.");
  if (Object.keys(input).sort().join(",") !== "expiresAt,publicKey,sessionId,version") throw new Error("Pairing registration contains unsupported fields.");
  if (input.version !== 2 || !PAIRING_SESSION.test(input.sessionId)) throw new Error("Invalid pairing session.");
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 86_700_000) throw new Error("Invalid pairing expiry.");
  const key = input.publicKey;
  if (!key || typeof key !== "object" || key.kty !== "EC" || key.crv !== "P-256" || key.d !== undefined ||
      typeof key.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(key.x) ||
      typeof key.y !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(key.y)) throw new Error("Invalid pairing public key.");
  return { version: 2, sessionId: input.sessionId, publicKey: { kty: "EC", crv: "P-256", x: key.x, y: key.y }, expiresAt: new Date(expiresAt).toISOString() };
}

function sweep(value) {
  return value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, " ").trim();
}

async function readJson(target, request, env, ctx, ttl) {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(target, { method: "GET" });
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return withCors(cached, request, env);
  const upstream = await fetch(target, { headers: { accept: "application/json", "User-Agent": "Agent-Guild/0.2" } });
  const response = new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": `public, max-age=${ttl}`,
      "x-content-type-options": "nosniff",
    },
  });
  if (cache && upstream.ok) ctx.waitUntil?.(cache.put(cacheKey, response.clone()));
  return withCors(response, request, env);
}

function assertWriteOrigin(request, env) {
  if (!env.APP_ORIGIN) throw new Error("Write origin is not configured.");
  if (request.headers.get("origin") !== env.APP_ORIGIN) throw new Error("Write origin is not allowed.");
}

function assertPairingOrigin(request, env) {
  if (!env.APP_ORIGIN) throw new Error("App origin is not configured.");
  if (request.headers.get("origin") !== env.APP_ORIGIN) throw new Error("Pairing origin is not allowed.");
}

async function readSmallJson(request, max) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > max) throw new Error("Request is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max) throw new Error("Request is too large.");
  return JSON.parse(text);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function json(body, status, request, env) {
  return withCors(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" },
  }), request, env);
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  if (request.method === "GET") headers.set("access-control-allow-origin", "*");
  else if (origin && origin === env.APP_ORIGIN) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,x-ag-timestamp,x-ag-nonce,x-ag-signature");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withPrivateCors(response, request, env) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  if (origin && origin === env.APP_ORIGIN) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,x-ag-timestamp,x-ag-nonce,x-ag-signature");
  headers.set("cache-control", "no-store");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function protocolMatches(env) {
  const targets = ["/config", "/openapi.json", "/llms.txt"];
  if (targets.some((path) => !expectedHash(env, path))) return false;
  const checks = await Promise.all(targets.map(async (path) => {
    const response = await fetch(`${TECHNOCORE}${path}`, { headers: { "User-Agent": "Agent-Guild/0.2" } });
    return response.ok && await sha256(await response.text()) === expectedHash(env, path);
  }));
  return checks.every(Boolean);
}

function expectedHash(env, path) {
  if (path === "/config") return env.EXPECTED_CONFIG_SHA256 || "";
  if (path === "/openapi.json") return env.EXPECTED_OPENAPI_SHA256 || "";
  if (path === "/llms.txt") return env.EXPECTED_LLMS_SHA256 || "";
  return "";
}

export class PairingSession {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/register") {
        const registration = validatePairingRegistration(await readSmallJson(request, 6_000));
        const existing = await this.state.storage.get("registration");
        if (existing && JSON.stringify(existing) !== JSON.stringify(registration)) {
          return pairingJson({ error: "Pairing session is already registered." }, 409);
        }
        if (!existing) {
          await this.state.storage.put("registration", registration);
          await this.state.storage.put("events", []);
          await this.state.storage.setAlarm(Date.parse(registration.expiresAt));
        }
        return pairingJson({ registered: true, expiresAt: registration.expiresAt }, existing ? 200 : 201);
      }

      const registration = await this.state.storage.get("registration");
      if (!registration || Date.parse(registration.expiresAt) <= Date.now()) return pairingJson({ error: "Pairing session expired or was not registered." }, 410);
      const body = request.method === "POST" ? await request.clone().text() : "";
      if (new TextEncoder().encode(body).length > 32_000) return pairingJson({ error: "Encrypted event is too large." }, 413);
      const authError = await verifyPairingAuth(request, registration.publicKey, body, this.state.storage);
      if (authError) return pairingJson({ error: authError }, 401);

      if (request.method === "GET" && url.pathname.endsWith("/events")) {
        const after = clampInt(url.searchParams.get("after"), 0, Number.MAX_SAFE_INTEGER, 0);
        const events = (await this.state.storage.get("events")) || [];
        return pairingJson({ events: events.filter((item) => item.seq > after) }, 200);
      }

      if (request.method === "POST" && url.pathname.endsWith("/events")) {
        const event = validateEncryptedEvent(JSON.parse(body));
        const events = (await this.state.storage.get("events")) || [];
        const duplicate = events.find((item) => item.envelope.eventId === event.envelope.eventId);
        if (duplicate) return pairingJson({ accepted: true, seq: duplicate.seq, duplicate: true }, 200);
        const seq = (events.at(-1)?.seq || 0) + 1;
        const next = [...events, { seq, envelope: event.envelope }].slice(-100);
        await this.state.storage.put("events", next);
        return pairingJson({ accepted: true, seq }, 201);
      }

      return pairingJson({ error: "Not found." }, 404);
    } catch (error) {
      return pairingJson({ error: error instanceof Error ? error.message : "Pairing request failed." }, 400);
    }
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

function validateEncryptedEvent(input) {
  if (!input || typeof input !== "object" || Object.keys(input).sort().join(",") !== "envelope,eventId") throw new Error("Encrypted event contains unsupported fields.");
  const envelope = input.envelope;
  if (!envelope || typeof envelope !== "object" || Object.keys(envelope).sort().join(",") !== "ciphertext,eventId,iv,version") throw new Error("Encrypted envelope contains unsupported fields.");
  if (input.eventId !== envelope.eventId || typeof input.eventId !== "string" || !/^[A-Za-z0-9_-]{8,96}$/.test(input.eventId)) throw new Error("Invalid encrypted event id.");
  if (envelope.version !== 1 || typeof envelope.iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(envelope.iv)) throw new Error("Invalid encrypted event IV.");
  if (typeof envelope.ciphertext !== "string" || envelope.ciphertext.length < 20 || envelope.ciphertext.length > 24_000 || !/^[A-Za-z0-9_-]+$/.test(envelope.ciphertext)) throw new Error("Invalid encrypted event ciphertext.");
  return { eventId: input.eventId, envelope: { version: 1, eventId: input.eventId, iv: envelope.iv, ciphertext: envelope.ciphertext } };
}

async function verifyPairingAuth(request, publicKey, body, storage) {
  const timestamp = request.headers.get("x-ag-timestamp") || "";
  const nonce = request.headers.get("x-ag-nonce") || "";
  const signature = request.headers.get("x-ag-signature") || "";
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 90) return "Pairing request timestamp is invalid.";
  if (!/^[A-Za-z0-9_-]{24}$/.test(nonce) || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return "Pairing request authentication is malformed.";
  const recent = ((await storage.get("recentNonces")) || []).filter((item) => item.at > Date.now() - 300_000);
  if (recent.some((item) => item.nonce === nonce)) return "Pairing request was already used.";
  const url = new URL(request.url);
  const canonical = `${request.method}\n${url.pathname}${url.search}\n${timestamp}\n${nonce}\n${await sha256(body)}`;
  const key = await crypto.subtle.importKey("jwk", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(canonical),
  );
  if (!valid) return "Pairing request signature is invalid.";
  await storage.put("recentNonces", [...recent, { nonce, at: Date.now() }].slice(-120));
  return "";
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function pairingJson(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
