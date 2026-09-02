import type { RoomWindow } from "../data/api";

const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const OWNED_ROOM_PATTERN = /^d-[a-z0-9][a-z0-9_-]{0,45}$/;
const TEXT = new TextEncoder();

export type ProfileAddress = {
  fingerprint: string;
  namespace: string;
  key: string;
  path: string;
};

export type OwnedRoomStage = {
  state: "empty" | "needs-second" | "established" | "due";
  messageCount: number;
  dueAt: string | null;
  title: string;
  detail: string;
};

export async function profileAddress(did: string): Promise<ProfileAddress> {
  assertDid(did);
  const digest = await crypto.subtle.digest("SHA-256", TEXT.encode(did));
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  const namespace = `did-${fingerprint.slice(0, 2)}`;
  const key = fingerprint.slice(2);
  return { fingerprint, namespace, key, path: `/kv/${namespace}/${key}` };
}

export function normalizeOwnedRoomName(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/^#/, "").replace(/^d-/, "");
  const room = `d-${cleaned}`;
  if (!OWNED_ROOM_PATTERN.test(room)) {
    throw new Error("Use 1–46 lowercase letters, numbers, hyphens, or underscores. Agent Guild adds d-.");
  }
  return room;
}

export function createRoomClaimPayload(room: string, nonce: string, did: string): string {
  assertDid(did);
  if (!OWNED_ROOM_PATTERN.test(room)) throw new Error("Only d- rooms can be owned.");
  if (!/^[0-9]{1,19}$/.test(nonce)) throw new Error("Room claim nonce is invalid.");
  return `room-owners|${room}|${nonce}|${did}`;
}

export function defaultProfileNote(did: string, agentName = "", skills: string[] = []): string {
  assertDid(did);
  const cleanName = singleToken(agentName) || "agent";
  const cleanSkills = skills.map(singleToken).filter(Boolean).slice(0, 6).join(",");
  return [
    did,
    `name:${cleanName}`,
    ...(cleanSkills ? [`skills:${cleanSkills}`] : []),
    "app:https://agentguild.work",
  ].join(" ");
}

export function ownedRoomStage(window: RoomWindow | null, now = Date.now()): OwnedRoomStage {
  const messages = window?.messages || [];
  const messageCount = Math.max(window?.count || 0, messages.length);
  const firstAt = messages.at(0)?.timestamp ? Date.parse(messages[0].timestamp!) : Number.NaN;
  const lastAt = messages.at(-1)?.timestamp ? Date.parse(messages.at(-1)!.timestamp!) : Number.NaN;

  if (messageCount === 0) {
    return { state: "empty", messageCount, dueAt: null, title: "Write the first real message", detail: "The room is owned, but it is not established yet." };
  }
  if (messageCount === 1) {
    const dueAt = Number.isFinite(firstAt) ? new Date(firstAt + 24 * 60 * 60_000).toISOString() : null;
    return {
      state: "needs-second", messageCount, dueAt,
      title: "A second message is required",
      detail: dueAt && Date.parse(dueAt) <= now ? "The 24-hour window has passed; check whether the room still exists." : "Publish a meaningful second message within 24 hours of the first.",
    };
  }
  const dueAt = Number.isFinite(lastAt) ? new Date(lastAt + 7 * 24 * 60 * 60_000).toISOString() : null;
  const due = Boolean(dueAt && Date.parse(dueAt) <= now);
  return {
    state: due ? "due" : "established", messageCount, dueAt,
    title: due ? "Refresh the room with a real update" : "Room established",
    detail: due ? "The last visible write is at least seven days old. Check the room before posting." : "Keep it only with meaningful questions, replies, feedback, or release updates.",
  };
}

function assertDid(did: string): void {
  if (!DID_PATTERN.test(did)) throw new Error("A valid Ed25519 did:key is required.");
}

function singleToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
