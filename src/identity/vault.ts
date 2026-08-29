const DID_PREFIX = new Uint8Array([0xed, 0x01]);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TEXT = new TextEncoder();

export const IDENTITY_FORMAT = "agent-guild.identity" as const;
export const IDENTITY_VERSION = 1 as const;
export const PBKDF2_ITERATIONS = 600_000;

export type EncryptedIdentity = {
  format: typeof IDENTITY_FORMAT;
  version: typeof IDENTITY_VERSION;
  agentName: string;
  did: string;
  publicKey: string;
  createdAt: string;
  protection: {
    kdf: "PBKDF2-HMAC-SHA256";
    iterations: number;
    salt: string;
    cipher: "AES-256-GCM";
    iv: string;
    ciphertext: string;
  };
};

export class IdentityVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityVaultError";
  }
}

export async function createEncryptedIdentity(
  agentName: string,
  passphrase: string,
): Promise<EncryptedIdentity> {
  const cleanName = validateAgentName(agentName);
  validatePassphrase(passphrase);

  ensureWebCrypto();
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const did = didFromPublicKey(publicKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  try {
    const encryptionKey = await deriveEncryptionKey(passphrase, salt, PBKDF2_ITERATIONS);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bufferOf(iv), additionalData: bufferOf(vaultContext(did)) },
      encryptionKey,
      bufferOf(privateKey),
    );

    return {
      format: IDENTITY_FORMAT,
      version: IDENTITY_VERSION,
      agentName: cleanName,
      did,
      publicKey: toBase64Url(publicKey),
      createdAt: new Date().toISOString(),
      protection: {
        kdf: "PBKDF2-HMAC-SHA256",
        iterations: PBKDF2_ITERATIONS,
        salt: toBase64Url(salt),
        cipher: "AES-256-GCM",
        iv: toBase64Url(iv),
        ciphertext: toBase64Url(new Uint8Array(encrypted)),
      },
    };
  } finally {
    privateKey.fill(0);
  }
}

export async function unlockIdentity(
  identity: EncryptedIdentity,
  passphrase: string,
): Promise<CryptoKey> {
  validateIdentity(identity);
  validatePassphrase(passphrase);
  ensureWebCrypto();

  const salt = fromBase64Url(identity.protection.salt);
  const iv = fromBase64Url(identity.protection.iv);
  const ciphertext = fromBase64Url(identity.protection.ciphertext);

  try {
    const encryptionKey = await deriveEncryptionKey(
      passphrase,
      salt,
      identity.protection.iterations,
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferOf(iv), additionalData: bufferOf(vaultContext(identity.did)) },
      encryptionKey,
      bufferOf(ciphertext),
    );
    const privateBytes = new Uint8Array(decrypted);

    try {
      return await crypto.subtle.importKey(
        "pkcs8",
        bufferOf(privateBytes),
        { name: "Ed25519" },
        false,
        ["sign"],
      );
    } finally {
      privateBytes.fill(0);
    }
  } catch {
    throw new IdentityVaultError("Incorrect passphrase or damaged identity backup.");
  }
}

export async function signText(privateKey: CryptoKey, message: string): Promise<string> {
  if (!message.trim()) throw new IdentityVaultError("Enter something to sign.");
  const signature = await crypto.subtle.sign("Ed25519", privateKey, bufferOf(TEXT.encode(message)));
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyText(
  identity: EncryptedIdentity,
  message: string,
  signature: string,
): Promise<boolean> {
  validateIdentity(identity);
  if (!message.trim() || !signature.trim()) return false;

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      bufferOf(fromBase64Url(identity.publicKey)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      bufferOf(fromBase64Url(signature)),
      bufferOf(TEXT.encode(message)),
    );
  } catch {
    return false;
  }
}

export async function verifyDidSignature(
  did: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const encoded = did.match(/^did:key:z(.+)$/u)?.[1];
    if (!encoded) return false;
    const decoded = base58Decode(encoded);
    if (decoded.length !== 34 || decoded[0] !== DID_PREFIX[0] || decoded[1] !== DID_PREFIX[1]) return false;
    const publicKey = await crypto.subtle.importKey(
      "raw",
      bufferOf(decoded.slice(2)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "Ed25519",
      publicKey,
      bufferOf(fromBase64Url(signature)),
      bufferOf(TEXT.encode(message)),
    );
  } catch {
    return false;
  }
}

export function exportIdentityBackup(identity: EncryptedIdentity): string {
  validateIdentity(identity);
  return JSON.stringify(identity, null, 2);
}

export function parseIdentityBackup(json: string): EncryptedIdentity {
  if (json.length > 100_000) throw new IdentityVaultError("Identity backup is too large.");

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new IdentityVaultError("This is not a valid identity backup.");
  }

  validateIdentity(value);
  return value;
}

export function shortDid(did: string): string {
  return did.length > 25 ? `${did.slice(0, 15)}…${did.slice(-7)}` : did;
}

function validateIdentity(value: unknown): asserts value is EncryptedIdentity {
  if (!value || typeof value !== "object") {
    throw new IdentityVaultError("This is not a valid identity backup.");
  }

  const identity = value as Partial<EncryptedIdentity>;
  const protection = identity.protection as Partial<EncryptedIdentity["protection"]> | undefined;
  if (
    identity.format !== IDENTITY_FORMAT ||
    identity.version !== IDENTITY_VERSION ||
    typeof identity.agentName !== "string" ||
    typeof identity.did !== "string" ||
    typeof identity.publicKey !== "string" ||
    typeof identity.createdAt !== "string" ||
    !protection ||
    protection.kdf !== "PBKDF2-HMAC-SHA256" ||
    protection.iterations !== PBKDF2_ITERATIONS ||
    protection.cipher !== "AES-256-GCM" ||
    typeof protection.salt !== "string" ||
    typeof protection.iv !== "string" ||
    typeof protection.ciphertext !== "string"
  ) {
    throw new IdentityVaultError("This is not a supported identity backup.");
  }

  const publicKey = fromBase64Url(identity.publicKey);
  if (publicKey.length !== 32 || didFromPublicKey(publicKey) !== identity.did) {
    throw new IdentityVaultError("The public DID does not match this identity backup.");
  }
  const encryptedPrivateKey = fromBase64Url(protection.ciphertext);
  if (
    fromBase64Url(protection.salt).length !== 16 ||
    fromBase64Url(protection.iv).length !== 12 ||
    encryptedPrivateKey.length < 32 ||
    encryptedPrivateKey.length > 512
  ) {
    throw new IdentityVaultError("The identity backup has invalid protection data.");
  }
  validateAgentName(identity.agentName);
  if (!Number.isFinite(Date.parse(identity.createdAt))) {
    throw new IdentityVaultError("The identity backup has an invalid creation date.");
  }
}

function validateAgentName(name: string): string {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 64) {
    throw new IdentityVaultError("Agent name must be between 2 and 64 characters.");
  }
  return clean;
}

function validatePassphrase(passphrase: string): void {
  if (passphrase.length < 12 || passphrase.length > 128) {
    throw new IdentityVaultError("Use a passphrase between 12 and 128 characters.");
  }
}

async function deriveEncryptionKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const passphraseBytes = TEXT.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      bufferOf(passphraseBytes),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: bufferOf(salt), iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    passphraseBytes.fill(0);
  }
}

function didFromPublicKey(publicKey: Uint8Array): string {
  const multicodec = new Uint8Array(DID_PREFIX.length + publicKey.length);
  multicodec.set(DID_PREFIX);
  multicodec.set(publicKey, DID_PREFIX.length);
  return `did:key:z${base58Encode(multicodec)}`;
}

function vaultContext(did: string): Uint8Array {
  return TEXT.encode(`${IDENTITY_FORMAT}:v${IDENTITY_VERSION}:${did}`);
}

function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits = [0];

  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = "";
  for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) {
    result += BASE58_ALPHABET[0];
  }
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    result += BASE58_ALPHABET[digits[index]];
  }
  return result;
}

function base58Decode(value: string): Uint8Array {
  if (!value || [...value].some((character) => !BASE58_ALPHABET.includes(character))) {
    throw new IdentityVaultError("The DID contains invalid base58 encoding.");
  }
  const bytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  while (leading < value.length - 1 && value[leading] === BASE58_ALPHABET[0]) leading += 1;
  return Uint8Array.from([...new Array(leading).fill(0), ...bytes.reverse()]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new IdentityVaultError("The identity backup contains invalid encoding.");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new IdentityVaultError("The identity backup contains invalid encoding.");
  }
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function ensureWebCrypto(): void {
  if (
    typeof window !== "undefined" &&
    !window.isSecureContext &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname)
  ) {
    throw new IdentityVaultError("Secure identity setup requires HTTPS or localhost.");
  }
  if (!globalThis.crypto?.subtle) {
    throw new IdentityVaultError("This browser does not support secure local identity setup.");
  }
}
