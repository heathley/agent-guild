import { normalizeKibbleBoardSnapshot, type KibbleBoardSnapshot } from "../protocol/kibble";
import { findKibbleJob, type KibbleJobState } from "../protocol/kibble-actions";
import type { Mission } from "../protocol/models";
import { edgeUrl } from "./edge";

export type PublicRoom = {
  room: string;
  topic: string;
  messages: number;
  activeAt: string | null;
};

export type PublicRoomMessage = {
  seq: number;
  timestamp: string | null;
  from: string;
  text: string;
  nonce: string | null;
  signature: string | null;
};

export type RoomWindow = {
  room: string;
  count: number;
  firstSeq: number | null;
  lastSeq: number | null;
  checkedAt: string;
  messages: PublicRoomMessage[];
};

export type SourceSnapshot = {
  rooms: PublicRoom[];
  communityJobs: Mission[];
  fetchedAt: string;
};

export type TechnocoreProtocolSource = {
  path: string;
  ok: boolean;
  status: number;
  sha256: string;
  expected: string;
  matches: boolean;
};

export type TechnocoreProtocolStatus = {
  checkedAt: string;
  sources: TechnocoreProtocolSource[];
};

export type TechnocorePresence = {
  did: string;
  checkedAt: string;
  profile: { exists: boolean; note: string; source: "sharded" | "legacy" | null; fingerprint: string; path: string };
  room?: { room: string; owner: string; nonce: string; window: RoomWindow };
};

const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export async function fetchTechnocoreRooms(signal?: AbortSignal): Promise<PublicRoom[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const payload = await requestJson("/api/technocore/rooms?limit=100", signal);
      const rooms = normalizeRooms(payload);
      if (rooms.length || attempt === 1) return rooms;
      lastError = new Error("Technocore returned an empty room snapshot.");
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (attempt === 1) throw error;
    }
    await pause(350, signal);
  }
  throw lastError instanceof Error ? lastError : new Error("Technocore rooms could not be read.");
}

export async function fetchKibbleJobs(signal?: AbortSignal): Promise<KibbleBoardSnapshot> {
  const payload = await requestJson("/api/kibble/board", signal, 45_000);
  const snapshot = normalizeKibbleBoardSnapshot(payload);
  return { ...snapshot, missions: snapshot.missions.slice(0, 60) };
}

export async function fetchKibbleJobState(jobId: string, signal?: AbortSignal): Promise<KibbleJobState | null> {
  const payload = await requestJson("/api/kibble/board", signal, 55_000);
  return findKibbleJob(payload, jobId);
}

export async function fetchTechnocoreRoom(room: string, signal?: AbortSignal): Promise<RoomWindow> {
  if (!ROOM_PATTERN.test(room)) throw new Error("This room name cannot be inspected safely.");
  const payload = await requestJson(`/api/technocore/room/${encodeURIComponent(room)}?limit=50`, signal);
  return normalizeRoomWindow(payload, room);
}

export async function fetchTechnocoreProtocolStatus(signal?: AbortSignal): Promise<TechnocoreProtocolStatus> {
  const payload = await requestJson("/api/technocore/meta", signal);
  if (!payload || typeof payload !== "object") throw new Error("Technocore publishing status could not be checked.");
  const value = payload as Record<string, unknown>;
  const rows = Array.isArray(value.sources) ? value.sources : [];
  const sources = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const source = row as Record<string, unknown>;
    const path = clean(source.path, 40);
    if (!["/config", "/openapi.json", "/llms.txt"].includes(path)) return [];
    return [{
      path,
      ok: source.ok === true,
      status: typeof source.status === "number" ? source.status : 0,
      sha256: clean(source.sha256, 64),
      expected: clean(source.expected, 64),
      matches: source.matches === true,
    } satisfies TechnocoreProtocolSource];
  });
  if (sources.length !== 3) throw new Error("Technocore publishing status is incomplete.");
  return {
    checkedAt: safeDate(value.checkedAt) || new Date().toISOString(),
    sources,
  };
}

export async function fetchTechnocorePresence(did: string, room = "", signal?: AbortSignal): Promise<TechnocorePresence> {
  const query = new URLSearchParams({ did });
  if (room) query.set("room", room);
  const payload = await requestJson(`/api/technocore/presence?${query}`, signal);
  if (!payload || typeof payload !== "object") throw new Error("Technocore presence status could not be read.");
  const value = payload as Record<string, unknown>;
  const profile = value.profile && typeof value.profile === "object" ? value.profile as Record<string, unknown> : {};
  const result: TechnocorePresence = {
    did: clean(value.did, 180), checkedAt: safeDate(value.checkedAt) || new Date().toISOString(),
    profile: {
      exists: profile.exists === true,
      note: clean(profile.note, 2_000),
      source: profile.source === "sharded" || profile.source === "legacy" ? profile.source : null,
      fingerprint: clean(profile.fingerprint, 16),
      path: clean(profile.path, 80),
    },
  };
  const roomValue = value.room && typeof value.room === "object" ? value.room as Record<string, unknown> : null;
  if (roomValue) {
    const name = clean(roomValue.room, 48);
    result.room = {
      room: name,
      owner: clean(roomValue.owner, 180),
      nonce: clean(roomValue.nonce, 19) || "0",
      window: normalizeRoomWindow(roomValue.window, name),
    };
  }
  return result;
}

export async function publishTechnocoreProfileNote(did: string, note: string): Promise<TechnocorePresence["profile"]> {
  const payload = await postJson("/api/technocore/profile-note", { did, note });
  if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).published !== true) throw new Error("Profile note was not confirmed by read-back.");
  const value = payload as Record<string, unknown>;
  return { exists: true, note: clean(value.note, 2_000), source: "sharded", fingerprint: "", path: clean(value.path, 80) };
}

export async function claimTechnocoreRoom(input: { room: string; did: string; nonce: string; sig: string }): Promise<{ room: string; owner: string; existing: boolean }> {
  const payload = await postJson("/api/technocore/claim-room", input);
  if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).claimed !== true) throw new Error("Room ownership was not confirmed by read-back.");
  const value = payload as Record<string, unknown>;
  return { room: clean(value.room, 48), owner: clean(value.owner, 180), existing: value.existing === true };
}

export function protocolStatusIsReady(status: TechnocoreProtocolStatus): boolean {
  return status.sources.length === 3 && status.sources.every((source) => source.ok && source.matches && source.expected.length === 64);
}

// Compatibility helper for callers that explicitly need both sources. The UI
// loads them independently so one unavailable source cannot hide the other.
export async function fetchSources(signal?: AbortSignal): Promise<SourceSnapshot> {
  const [rooms, communityBoard] = await Promise.all([
    fetchTechnocoreRooms(signal),
    fetchKibbleJobs(signal),
  ]);
  return { rooms, communityJobs: communityBoard.missions, fetchedAt: new Date().toISOString() };
}

export function roomToMission(room: PublicRoom, finishLine?: string, sourceWindow?: RoomWindow): Mission {
  const hasRange = sourceWindow?.firstSeq !== null && sourceWindow?.firstSeq !== undefined && sourceWindow.lastSeq !== null;
  const scoped = hasRange
    ? `Latest visible window checked: sequences ${sourceWindow.firstSeq}–${sourceWindow.lastSeq}. This does not prove older room history.`
    : "Only the latest public room window was inspected; older history may be outside coverage.";
  return {
    id: `technocore:${room.room}:${sourceWindow?.lastSeq ?? room.messages}`,
    source: "technocore-signal",
    title: `Investigate #${room.room}`,
    summary: `${room.topic || "No public topic was supplied."} ${scoped}`,
    room: room.room,
    successCriteria: [finishLine || "Confirm one concrete need with its author and produce a stranger-checkable artifact"],
    verification: "A signed public result must be read back from the same room before it becomes verified.",
    risk: "medium",
    observedAt: sourceWindow?.checkedAt || room.activeAt || new Date(0).toISOString(),
    ...(sourceWindow?.lastSeq !== null && sourceWindow?.lastSeq !== undefined ? { sourceSeq: sourceWindow.lastSeq } : {}),
  };
}

export function normalizeRooms(input: unknown): PublicRoom[] {
  if (!input || typeof input !== "object") return [];
  const list = (input as { rooms?: unknown }).rooms;
  if (!Array.isArray(list)) return [];
  return list.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const room = clean(value.room, 48);
    if (!ROOM_PATTERN.test(room)) return [];
    const topic = clean(value.topic, 280);
    const count = [value.last_seq, value.messages, value.count, value.message_count].find((item) => typeof item === "number");
    const rawDate = [value.last_write, value.updated_at, value.last_active, value.ts].find((item) => typeof item === "string");
    return [{ room, topic, messages: typeof count === "number" ? count : 0, activeAt: safeDate(rawDate) }];
  });
}

export function normalizeRoomWindow(input: unknown, expectedRoom: string): RoomWindow {
  if (!input || typeof input !== "object") throw new Error("Technocore returned an unreadable room window.");
  const value = input as Record<string, unknown>;
  const room = clean(value.room, 48);
  if (room !== expectedRoom || !ROOM_PATTERN.test(room)) throw new Error("Technocore returned a different room than requested.");
  const rows = Array.isArray(value.messages) ? value.messages : [];
  const messages = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const message = row as Record<string, unknown>;
    const seq = typeof message.seq === "number" && Number.isSafeInteger(message.seq) ? message.seq : null;
    const text = clean(message.text, 2_000);
    if (seq === null || !text) return [];
    return [{
      seq,
      timestamp: safeDate(message.ts),
      from: clean(message.from, 180) || "unknown",
      text,
      nonce: typeof message.nonce === "string" || typeof message.nonce === "number" ? clean(String(message.nonce), 32) : null,
      signature: typeof message.sig === "string" && /^[A-Za-z0-9_-]{85}[AQgw]$/.test(message.sig) ? message.sig : null,
    } satisfies PublicRoomMessage];
  });
  const firstSeq = safeSeq(value.first_seq) ?? messages.at(0)?.seq ?? null;
  const lastSeq = safeSeq(value.last_seq) ?? messages.at(-1)?.seq ?? null;
  return {
    room,
    count: typeof value.count === "number" && Number.isSafeInteger(value.count) ? value.count : messages.length,
    firstSeq,
    lastSeq,
    checkedAt: new Date().toISOString(),
    messages,
  };
}

async function requestJson(path: string, signal?: AbortSignal, timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  let response: Response;
  try {
    response = await fetch(edgeUrl(path), { signal: controller.signal, headers: { accept: "application/json" } });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error("The public source is taking too long to wake up. Try again in a moment.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
  if (!response.ok) {
    let detail = "";
    try { detail = clean((await response.json() as { error?: unknown }).error, 240); } catch { /* upstream may not return JSON */ }
    throw new Error(detail || `Public source returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function postJson(path: string, body: unknown, timeoutMs = 25_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(edgeUrl(path), { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      let detail = "";
      try { detail = clean((await response.json() as { error?: unknown }).error, 300); } catch { /* non-JSON upstream */ }
      throw new Error(detail || `Public source returned HTTP ${response.status}.`);
    }
    return response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Technocore took too long to confirm this action. Read the public state before trying again.");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("The request was cancelled.", "AbortError"));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("The request was cancelled.", "AbortError"));
    }, { once: true });
  });
}

function safeSeq(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function safeDate(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max)
    : "";
}
