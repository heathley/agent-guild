const TECHNOCORE = "https://technocore.chat";
const KIBBLE = "https://flop-kibble.onrender.com";
const ROOM = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const NONCE = /^[0-9]{1,19}$/;
const SIG = /^[A-Za-z0-9_-]{86}$/;

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
  headers.set("access-control-allow-headers", "content-type");
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
