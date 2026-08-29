import { createHash, randomBytes, webcrypto } from "node:crypto";

export type EncryptedConnectorEvent = {
  version: 1;
  iv: string;
  ciphertext: string;
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

