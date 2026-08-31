import type { PublicActivityRecord, Receipt } from "../protocol/models";

const KEY = "agent-guild:public-activity";
const ROOM = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const KINDS = new Set(["reply", "question", "help", "progress", "claim", "result", "review"]);

export function loadPublicActivity(): PublicActivityRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value.filter(isRecord).slice(-100) : [];
  } catch { return []; }
}

export function savePublicActivity(records: PublicActivityRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(records.filter(isRecord).slice(-100)));
}

export function splitPublicActivity(records: readonly PublicActivityRecord[]): {
  visible: PublicActivityRecord[];
  prepared: PublicActivityRecord[];
} {
  return {
    visible: records.filter((item) => item.state === "published" || item.state === "verified"),
    prepared: records.filter((item) => item.state === "draft" || item.state === "prepared"),
  };
}

function isRecord(value: unknown): value is PublicActivityRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PublicActivityRecord>;
  const baseIsValid = typeof item.id === "string" && KINDS.has(item.kind || "") && typeof item.room === "string" && ROOM.test(item.room) &&
    typeof item.exactText === "string" && item.exactText.length > 0 && item.exactText.length <= 4096 &&
    ["draft", "prepared", "published", "verified"].includes(item.state || "") && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) &&
    (item.replyToSeq === undefined || Number.isSafeInteger(item.replyToSeq));
  if (!baseIsValid) return false;
  if (item.receipt !== undefined && !isReceipt(item.receipt)) return false;
  if (item.receipt && (item.receipt.room !== item.room || item.receipt.normalizedText !== item.exactText)) return false;
  return item.state !== "verified" || item.receipt !== undefined;
}

function isReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<Receipt>;
  return typeof receipt.room === "string" && ROOM.test(receipt.room) &&
    Number.isSafeInteger(receipt.seq) && Number(receipt.seq) >= 0 &&
    typeof receipt.serverTimestamp === "string" && Number.isFinite(Date.parse(receipt.serverTimestamp)) &&
    typeof receipt.did === "string" && /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/.test(receipt.did) &&
    typeof receipt.nonce === "string" && /^[0-9]{1,19}$/.test(receipt.nonce) &&
    typeof receipt.normalizedText === "string" && receipt.normalizedText.length > 0 && receipt.normalizedText.length <= 4096 &&
    typeof receipt.textSha256 === "string" && /^[a-f0-9]{64}$/i.test(receipt.textSha256) &&
    typeof receipt.signature === "string" && /^[A-Za-z0-9_-]{86}$/.test(receipt.signature) &&
    (receipt.resultHash === undefined || /^(?:sha256:)?[a-f0-9]{64}$/i.test(receipt.resultHash)) &&
    typeof receipt.verifiedAt === "string" && Number.isFinite(Date.parse(receipt.verifiedAt));
}
