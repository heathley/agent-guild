import {
  sanitizeBridgePayload, sanitizeMissionAssignment,
  type AgentBridgeEvent, type MissionAssignment,
} from "./contract.js";

export type EncryptedEventEnvelope = { version: 1; eventId: string; iv: string; ciphertext: string };

export type RelayPairingFile = {
  version: 2;
  sessionId: string;
  agentDid?: string;
  relayUrl: string;
  encryptionKey: string;
  signingPrivateKey: JsonWebKey;
  signingPublicKey: JsonWebKey;
  createdAt: string;
  expiresAt: string;
};

export type RelayedEvent = { seq: number; envelope: EncryptedEventEnvelope };

export function createPairToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `agp_${encode(bytes)}`;
}

export async function pairingSessionId(token: string): Promise<string> {
  validateToken(token);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`agent-guild-session:${token}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function decryptConnectorEvent(token: string, envelope: EncryptedEventEnvelope): Promise<AgentBridgeEvent> {
  validateToken(token);
  if (envelope.version !== 1 || !envelope.eventId || !envelope.iv || !envelope.ciphertext) throw new Error("Invalid encrypted event envelope.");
  const keyDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`agent-guild-pairing:${token}`));
  const key = await crypto.subtle.importKey("raw", keyDigest, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferOf(decode(envelope.iv)) }, key, bufferOf(decode(envelope.ciphertext)));
  const event = sanitizeBridgePayload(JSON.parse(new TextDecoder().decode(plaintext)));
  if (!event || event.eventId !== envelope.eventId) throw new Error("Encrypted event failed the bridge allowlist.");
  return event;
}

export async function createRelayPairing(relayUrl: string, agentDid?: string): Promise<RelayPairingFile> {
  const signingKeys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const now = Date.now();
  return {
    version: 2,
    sessionId: encode(crypto.getRandomValues(new Uint8Array(24))),
    ...(agentDid ? { agentDid } : {}),
    relayUrl: new URL(relayUrl).origin,
    encryptionKey: encode(crypto.getRandomValues(new Uint8Array(32))),
    signingPrivateKey: await crypto.subtle.exportKey("jwk", signingKeys.privateKey),
    signingPublicKey: await crypto.subtle.exportKey("jwk", signingKeys.publicKey),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function registerRelayPairing(pairing: RelayPairingFile): Promise<void> {
  validateRelayPairing(pairing);
  const response = await fetch(`${pairing.relayUrl}/api/pairing/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      version: pairing.version,
      sessionId: pairing.sessionId,
      publicKey: pairing.signingPublicKey,
      expiresAt: pairing.expiresAt,
    }),
  });
  if (!response.ok) throw new Error("Encrypted relay is not available on this build.");
}

export async function pollRelayEvents(pairing: RelayPairingFile, after: number): Promise<RelayedEvent[]> {
  validateRelayPairing(pairing);
  const path = `/api/pairing/${pairing.sessionId}/events?after=${Math.max(0, Math.trunc(after))}`;
  const headers = await relayAuthHeaders(pairing, "GET", path, "");
  const response = await fetch(`${pairing.relayUrl}${path}`, { headers });
  if (!response.ok) throw new Error("Encrypted relay polling failed.");
  const data = await response.json() as { events?: RelayedEvent[] };
  return Array.isArray(data.events) ? data.events : [];
}

export async function sendRelayAssignment(pairing: RelayPairingFile, input: unknown): Promise<number> {
  validateRelayPairing(pairing);
  const assignment = sanitizeMissionAssignment(input);
  if (!assignment) throw new Error("Mission assignment failed the strict bridge allowlist.");
  if (assignment.agentDid !== pairing.agentDid) throw new Error("Mission assignment DID does not match this pairing session.");
  const envelope = await encryptRelayPayload(pairing, assignment, assignment.assignmentId);
  const path = `/api/pairing/${pairing.sessionId}/commands`;
  const body = JSON.stringify({ eventId: assignment.assignmentId, envelope });
  const headers = await relayAuthHeaders(pairing, "POST", path, body);
  const response = await fetch(`${pairing.relayUrl}${path}`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body,
  });
  if (!response.ok) throw new Error(`Encrypted mission handoff was rejected (${response.status}).`);
  const result = await response.json() as { seq?: number };
  if (!Number.isInteger(result.seq)) throw new Error("Encrypted relay returned an invalid mission receipt.");
  return result.seq as number;
}

export async function decryptMissionAssignment(pairing: RelayPairingFile, envelope: EncryptedEventEnvelope): Promise<MissionAssignment> {
  const value = await decryptRelayPayload(pairing, envelope);
  const assignment = sanitizeMissionAssignment(value);
  if (!assignment || assignment.assignmentId !== envelope.eventId) throw new Error("Encrypted mission failed the bridge allowlist.");
  return assignment;
}

export async function decryptRelayedEvent(pairing: RelayPairingFile, envelope: EncryptedEventEnvelope): Promise<AgentBridgeEvent> {
  const event = sanitizeBridgePayload(await decryptRelayPayload(pairing, envelope));
  if (!event || event.eventId !== envelope.eventId) throw new Error("Encrypted event failed the bridge allowlist.");
  return event;
}

export function exportRelayPairing(pairing: RelayPairingFile): string {
  validateRelayPairing(pairing);
  return JSON.stringify(pairing, null, 2);
}

export function parseRelayPairing(serialized: string, expectedRelayUrl: string, expectedDid: string): RelayPairingFile {
  if (new TextEncoder().encode(serialized).length > 16_000) throw new Error("Pairing file is too large.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error("Pairing file is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Pairing file must contain one object.");
  const allowed = ["agentDid", "createdAt", "encryptionKey", "expiresAt", "relayUrl", "sessionId", "signingPrivateKey", "signingPublicKey", "version"];
  if (Object.keys(parsed).sort().join(",") !== allowed.join(",")) throw new Error("Pairing file contains unsupported fields.");
  const pairing = parsed as RelayPairingFile;
  validateRelayPairing(pairing);
  if (pairing.agentDid !== expectedDid) throw new Error("This pairing file belongs to a different agent DID.");
  if (pairing.relayUrl !== new URL(expectedRelayUrl).origin) throw new Error("This pairing file belongs to a different relay.");
  return pairing;
}

async function relayAuthHeaders(pairing: RelayPairingFile, method: string, path: string, body: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = encode(crypto.getRandomValues(new Uint8Array(18)));
  const bodyHash = await sha256Hex(body);
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    pairing.signingPrivateKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(canonical),
  );
  return {
    "x-ag-timestamp": timestamp,
    "x-ag-nonce": nonce,
    "x-ag-signature": encode(new Uint8Array(signature)),
  };
}

async function encryptRelayPayload(pairing: RelayPairingFile, value: unknown, eventId: string): Promise<EncryptedEventEnvelope> {
  validateRelayPairing(pairing);
  const rawKey = decode(pairing.encryptionKey);
  const key = await crypto.subtle.importKey("raw", bufferOf(rawKey), "AES-GCM", false, ["encrypt"]);
  rawKey.fill(0);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferOf(iv) }, key, plaintext);
    return { version: 1, eventId, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
  } finally {
    plaintext.fill(0);
  }
}

async function decryptRelayPayload(pairing: RelayPairingFile, envelope: EncryptedEventEnvelope): Promise<unknown> {
  validateRelayPairing(pairing);
  if (envelope.version !== 1 || !envelope.eventId || !envelope.iv || !envelope.ciphertext) throw new Error("Invalid encrypted relay envelope.");
  const rawKey = decode(pairing.encryptionKey);
  const key = await crypto.subtle.importKey("raw", bufferOf(rawKey), "AES-GCM", false, ["decrypt"]);
  rawKey.fill(0);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferOf(decode(envelope.iv)) }, key, bufferOf(decode(envelope.ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function validateRelayPairing(pairing: RelayPairingFile): void {
  if (pairing.version !== 2 || !/^[A-Za-z0-9_-]{32}$/.test(pairing.sessionId)) throw new Error("Invalid relay pairing file.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(pairing.encryptionKey)) throw new Error("Invalid relay encryption key.");
  if (pairing.agentDid !== undefined && !/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/.test(pairing.agentDid)) throw new Error("Invalid paired agent DID.");
  const createdAt = Date.parse(pairing.createdAt);
  const expiresAt = Date.parse(pairing.expiresAt);
  if (!Number.isFinite(createdAt) || createdAt > Date.now() + 300_000) throw new Error("Invalid pairing creation time.");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Pairing session expired. Generate a new one.");
  if (expiresAt > createdAt + 86_700_000) throw new Error("Invalid pairing session duration.");
  const relay = new URL(pairing.relayUrl);
  if (pairing.relayUrl !== relay.origin || (relay.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(relay.hostname))) throw new Error("Invalid pairing relay URL.");
  if (!isPairingJwk(pairing.signingPrivateKey, true) || !isPairingJwk(pairing.signingPublicKey, false)) throw new Error("Invalid relay signing keys.");
}

function isPairingJwk(value: JsonWebKey, privateKey: boolean): boolean {
  const allowed = privateKey ? ["crv", "d", "ext", "key_ops", "kty", "x", "y"] : ["crv", "ext", "key_ops", "kty", "x", "y"];
  return Boolean(value && Object.keys(value).sort().join(",") === allowed.join(",") && value.kty === "EC" && value.crv === "P-256" && value.ext === true &&
    typeof value.x === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.x) &&
    typeof value.y === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.y) &&
    (privateKey ? typeof value.d === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.d) : value.d === undefined) &&
    Array.isArray(value.key_ops) && value.key_ops.length === 1 && value.key_ops[0] === (privateKey ? "sign" : "verify"));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateToken(token: string) {
  if (!/^agp_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid pairing token.");
}
function encode(bytes: Uint8Array): string {
  let value = ""; for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function bufferOf(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
