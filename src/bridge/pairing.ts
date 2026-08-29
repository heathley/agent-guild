import { sanitizeBridgePayload, type AgentBridgeEvent } from "./contract.js";

export type EncryptedEventEnvelope = { version: 1; eventId: string; iv: string; ciphertext: string };

export type RelayPairingFile = {
  version: 2;
  sessionId: string;
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

export async function createRelayPairing(relayUrl: string): Promise<RelayPairingFile> {
  const signingKeys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const now = Date.now();
  return {
    version: 2,
    sessionId: encode(crypto.getRandomValues(new Uint8Array(24))),
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

export async function decryptRelayedEvent(pairing: RelayPairingFile, envelope: EncryptedEventEnvelope): Promise<AgentBridgeEvent> {
  validateRelayPairing(pairing);
  const rawKey = decode(pairing.encryptionKey);
  const key = await crypto.subtle.importKey("raw", bufferOf(rawKey), "AES-GCM", false, ["decrypt"]);
  rawKey.fill(0);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferOf(decode(envelope.iv)) },
    key,
    bufferOf(decode(envelope.ciphertext)),
  );
  const event = sanitizeBridgePayload(JSON.parse(new TextDecoder().decode(plaintext)));
  if (!event || event.eventId !== envelope.eventId) throw new Error("Encrypted event failed the bridge allowlist.");
  return event;
}

export function exportRelayPairing(pairing: RelayPairingFile): string {
  validateRelayPairing(pairing);
  return JSON.stringify(pairing, null, 2);
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

function validateRelayPairing(pairing: RelayPairingFile): void {
  if (pairing.version !== 2 || !/^[A-Za-z0-9_-]{32}$/.test(pairing.sessionId)) throw new Error("Invalid relay pairing file.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(pairing.encryptionKey)) throw new Error("Invalid relay encryption key.");
  if (Date.parse(pairing.expiresAt) <= Date.now()) throw new Error("Pairing session expired. Generate a new one.");
  if (pairing.signingPrivateKey.kty !== "EC" || pairing.signingPublicKey.kty !== "EC") throw new Error("Invalid relay signing keys.");
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
