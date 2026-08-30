import type { PublicActivityRecord } from "../protocol/models";

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

function isRecord(value: unknown): value is PublicActivityRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PublicActivityRecord>;
  return typeof item.id === "string" && KINDS.has(item.kind || "") && typeof item.room === "string" && ROOM.test(item.room) &&
    typeof item.exactText === "string" && item.exactText.length > 0 && item.exactText.length <= 4096 &&
    ["draft", "prepared", "published", "verified"].includes(item.state || "") && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) &&
    (item.replyToSeq === undefined || Number.isSafeInteger(item.replyToSeq));
}
