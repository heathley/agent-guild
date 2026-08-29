import { createHash, randomBytes, webcrypto } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export type EncryptedConnectorEvent = {
  version: 1;
  iv: string;
  ciphertext: string;
};

export type ConnectorPairingFile = {
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

export function validatePairingToken(token: string): string {
  if (!/^agp_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("Pairing token is malformed. Generate a fresh token in Agent Guild.");
  }
  return token;
}

export function pairingSessionId(token: string): string {
  validatePairingToken(token);
  return createHash("sha256").update(`agent-guild-session:${token}`).digest("hex").slice(0, 32);
}

export async function encryptConnectorEvent(token: string, event: unknown): Promise<EncryptedConnectorEvent> {
  validatePairingToken(token);
  const keyBytes = createHash("sha256").update(`agent-guild-pairing:${token}`).digest();
  const key = await webcrypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(event));
  try {
    const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return { version: 1, iv: iv.toString("base64url"), ciphertext: Buffer.from(encrypted).toString("base64url") };
  } finally {
    plaintext.fill(0);
    keyBytes.fill(0);
  }
}

export async function readConnectorPairingFile(path: string): Promise<ConnectorPairingFile> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 16_000) throw new Error("Pairing file is invalid.");
  const pairing = JSON.parse(await readFile(path, "utf8")) as ConnectorPairingFile;
  validateConnectorPairing(pairing);
  return pairing;
}

export async function encryptRelayedConnectorEvent(pairing: ConnectorPairingFile, event: unknown): Promise<EncryptedConnectorEvent> {
  validateConnectorPairing(pairing);
  const keyBytes = Buffer.from(pairing.encryptionKey, "base64url");
  const key = await webcrypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(event));
  try {
    const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return { version: 1, iv: iv.toString("base64url"), ciphertext: Buffer.from(encrypted).toString("base64url") };
  } finally {
    plaintext.fill(0);
    keyBytes.fill(0);
  }
}

export async function relayConnectorEvent(pairing: ConnectorPairingFile, eventId: string, envelope: EncryptedConnectorEvent): Promise<number> {
  validateConnectorPairing(pairing);
  const path = `/api/pairing/${pairing.sessionId}/events`;
  const body = JSON.stringify({ eventId, envelope: { ...envelope, eventId } });
  const headers = await connectorAuthHeaders(pairing, "POST", path, body);
  const response = await fetch(`${pairing.relayUrl}${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body });
  if (!response.ok) throw new Error(`Encrypted relay rejected the lifecycle event (${response.status}).`);
  const result = await response.json() as { seq?: number };
  if (!Number.isInteger(result.seq)) throw new Error("Encrypted relay returned an invalid receipt.");
  return result.seq as number;
}

function validateConnectorPairing(pairing: ConnectorPairingFile): void {
  if (pairing.version !== 2 || !/^[A-Za-z0-9_-]{32}$/.test(pairing.sessionId)) throw new Error("Pairing file is malformed.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(pairing.encryptionKey)) throw new Error("Pairing file encryption key is malformed.");
  if (pairing.agentDid !== undefined && !/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/.test(pairing.agentDid)) throw new Error("Pairing file agent DID is malformed.");
  if (pairing.signingPrivateKey?.kty !== "EC" || pairing.signingPublicKey?.kty !== "EC") throw new Error("Pairing file signing keys are malformed.");
  if (Date.parse(pairing.expiresAt) <= Date.now()) throw new Error("Pairing file expired. Generate a fresh file in Agent Guild.");
  const url = new URL(pairing.relayUrl);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("Pairing relay must use HTTPS.");
}

async function connectorAuthHeaders(pairing: ConnectorPairingFile, method: string, path: string, body: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(18).toString("base64url");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const key = await webcrypto.subtle.importKey("jwk", pairing.signingPrivateKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(canonical));
  return { "x-ag-timestamp": timestamp, "x-ag-nonce": nonce, "x-ag-signature": Buffer.from(signature).toString("base64url") };
}
