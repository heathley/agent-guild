import type { Receipt } from "./models";

const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const NONCE_PATTERN = /^[0-9]{1,19}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const TEXT = new TextEncoder();

export type TechnocoreRoomMessage = {
  seq: number;
  ts: string;
  from: string;
  text: string;
  nonce?: string | number;
};

export type SignedTechnocoreMessage = {
  room: string;
  from: string;
  text: string;
  nonce: string;
  sig: string;
};

export function sweepTechnocoreText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, " ").trim();
}

export function createSigningPayload(room: string, nonce: string, text: string): string {
  assertRoom(room);
  assertNonce(nonce);
  const swept = sweepTechnocoreText(text);
  if (!swept || TEXT.encode(swept).length > 4096) {
    throw new Error("Technocore text must contain 1–4096 UTF-8 bytes after sweeping.");
  }
  return `${room}|${nonce}|${swept}`;
}

export function nextNonce(previous?: string, now = Date.now()): string {
  const floor = previous ? BigInt(previous) + 1n : 1n;
  const candidate = BigInt(now);
  const next = candidate > floor ? candidate : floor;
  if (next.toString().length > 19) throw new Error("Nonce is outside the supported range.");
  return next.toString();
}

export function validateSignedMessage(value: unknown): SignedTechnocoreMessage {
  if (!value || typeof value !== "object") throw new Error("Signed message must be an object.");
  const message = value as Partial<SignedTechnocoreMessage>;
  assertRoom(message.room);
  if (typeof message.from !== "string" || !DID_PATTERN.test(message.from)) {
    throw new Error("A valid did:key sender is required.");
  }
  assertNonce(message.nonce);
  if (typeof message.text !== "string") throw new Error("Message text is required.");
  const swept = sweepTechnocoreText(message.text);
  if (message.text !== swept) throw new Error("Message text must already match the Technocore sweep.");
  createSigningPayload(message.room, message.nonce, message.text);
  if (typeof message.sig !== "string" || !SIGNATURE_PATTERN.test(message.sig)) {
    throw new Error("Technocore requires an 86-character base64url Ed25519 signature.");
  }
  return message as SignedTechnocoreMessage;
}

export function findPublishedMessage(
  messages: readonly TechnocoreRoomMessage[],
  expected: Pick<SignedTechnocoreMessage, "from" | "nonce" | "text">,
): TechnocoreRoomMessage | null {
  const normalized = sweepTechnocoreText(expected.text);
  return (
    messages.find(
      (message) =>
        message.from === expected.from &&
        String(message.nonce) === expected.nonce &&
        message.text === normalized,
    ) ?? null
  );
}

export async function createReceipt(
  room: string,
  published: TechnocoreRoomMessage,
  signature: string,
  resultHash?: string,
): Promise<Receipt> {
  assertRoom(room);
  return {
    room,
    seq: published.seq,
    serverTimestamp: published.ts,
    did: published.from,
    nonce: String(published.nonce),
    normalizedText: published.text,
    textSha256: await sha256(published.text),
    signature,
    ...(resultHash ? { resultHash } : {}),
    verifiedAt: new Date().toISOString(),
  };
}

export function isIndependentReview(
  workerDid: string,
  reviewerDid: string,
  expectedResultHash: string,
  reviewedResultHash: string,
): boolean {
  return (
    DID_PATTERN.test(workerDid) &&
    DID_PATTERN.test(reviewerDid) &&
    workerDid !== reviewerDid &&
    expectedResultHash.length > 0 &&
    expectedResultHash === reviewedResultHash
  );
}

export function assertRoom(room: unknown): asserts room is string {
  if (typeof room !== "string" || !ROOM_PATTERN.test(room)) {
    throw new Error("Room names must be 1–48 lowercase letters, digits, underscores or hyphens.");
  }
}

export function assertNonce(nonce: unknown): asserts nonce is string {
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
    throw new Error("Nonce must contain 1–19 decimal digits.");
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", TEXT.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
