import type { LedgerEntry } from "../protocol/models";

const DATABASE = "agent-guild-local";
const STORE = "contribution-ledger";
const RECORD = "entries";
const TEXT = new TextEncoder();

export async function loadLedger(): Promise<LedgerEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  try {
    const stored = await requestToPromise<unknown>(database.transaction(STORE, "readonly").objectStore(STORE).get(RECORD));
    return Array.isArray(stored) ? stored.filter(isLedgerEntry) : [];
  } finally { database.close(); }
}

export async function saveLedger(entries: LedgerEntry[]): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(entries.filter(isLedgerEntry), RECORD);
    await transactionDone(transaction);
  } finally { database.close(); }
}

export async function exportEncryptedLedger(entries: LedgerEntry[], passphrase: string): Promise<string> {
  if (passphrase.length < 12) throw new Error("Use a backup passphrase of at least 12 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const plaintext = TEXT.encode(JSON.stringify(entries.filter(isLedgerEntry)));
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return JSON.stringify({
      format: "agent-guild.ledger", version: 1, kdf: "PBKDF2-HMAC-SHA256", iterations: 300_000,
      salt: encode(salt), cipher: "AES-256-GCM", iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)),
    }, null, 2);
  } finally { plaintext.fill(0); }
}

export async function importEncryptedLedger(backup: string, passphrase: string): Promise<LedgerEntry[]> {
  const data = JSON.parse(backup) as Record<string, unknown>;
  if (data.format !== "agent-guild.ledger" || data.version !== 1 || data.iterations !== 300_000 ||
    typeof data.salt !== "string" || typeof data.iv !== "string" || typeof data.ciphertext !== "string") {
    throw new Error("Unsupported ledger backup.");
  }
  try {
    const salt = decode(data.salt);
    const iv = decode(data.iv);
    const key = await derive(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferOf(iv) }, key, bufferOf(decode(data.ciphertext)));
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (!Array.isArray(parsed) || !parsed.every(isLedgerEntry)) throw new Error("Invalid ledger data.");
    return parsed;
  } catch {
    throw new Error("Incorrect passphrase or damaged ledger backup.");
  }
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LedgerEntry>;
  return typeof item.id === "string" && typeof item.state === "string" && typeof item.createdAt === "string" &&
    !!item.mission && typeof item.mission.id === "string" && typeof item.mission.title === "string";
}

async function derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const bytes = TEXT.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: bufferOf(salt), iterations: 300_000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } finally { bytes.fill(0); }
}

function encode(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("encrypted-identities")) request.result.createObjectStore("encrypted-identities");
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local ledger."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Ledger read failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Ledger write failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Ledger write was interrupted."));
  });
}
