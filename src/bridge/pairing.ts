import { sanitizeBridgePayload, type AgentBridgeEvent } from "./contract";

export type EncryptedEventEnvelope = { version: 1; eventId: string; iv: string; ciphertext: string };

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

