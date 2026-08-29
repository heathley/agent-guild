import { normalizeKibbleBoard } from "../protocol/kibble";
import type { Mission } from "../protocol/models";
import { edgeUrl } from "./edge";

export type PublicRoom = {
  room: string;
  topic: string;
  messages: number;
  activeAt: string | null;
};

export type SourceSnapshot = {
  rooms: PublicRoom[];
  communityJobs: Mission[];
  fetchedAt: string;
};

export async function fetchSources(signal?: AbortSignal): Promise<SourceSnapshot> {
  const [roomsResponse, boardResponse] = await Promise.allSettled([
    fetch(edgeUrl("/api/technocore/rooms?limit=40"), { signal, headers: { accept: "application/json" } }),
    fetch(edgeUrl("/api/kibble/board"), { signal, headers: { accept: "application/json" } }),
  ]);

  const rooms = roomsResponse.status === "fulfilled" && roomsResponse.value.ok
    ? normalizeRooms(await roomsResponse.value.json())
    : [];
  const communityJobs = boardResponse.status === "fulfilled" && boardResponse.value.ok
    ? normalizeKibbleBoard(await boardResponse.value.json()).slice(0, 60)
    : [];

  if (roomsResponse.status === "rejected" && boardResponse.status === "rejected") {
    throw new Error("Public sources could not be reached. Your local workspace is still available.");
  }
  return { rooms, communityJobs, fetchedAt: new Date().toISOString() };
}

export function roomToMission(room: PublicRoom): Mission {
  return {
    id: `technocore:${room.room}`,
    source: "technocore-signal",
    title: `Explore #${room.room}`,
    summary: room.topic || "Inspect the newest public messages and identify one concrete, author-confirmed need.",
    room: room.room,
    successCriteria: ["Confirm a specific need with public evidence", "Define a verifiable artifact before claiming work"],
    verification: "A signed public result must be read back from the same room before it becomes verified.",
    risk: "medium",
    observedAt: room.activeAt || new Date(0).toISOString(),
  };
}

function normalizeRooms(input: unknown): PublicRoom[] {
  if (!input || typeof input !== "object") return [];
  const list = (input as { rooms?: unknown }).rooms;
  if (!Array.isArray(list)) return [];
  return list.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const room = clean(value.room, 48);
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) return [];
    const topic = clean(value.topic, 280);
    const count = [value.last_seq, value.messages, value.count, value.message_count].find((item) => typeof item === "number");
    const rawDate = [value.last_write, value.updated_at, value.last_active, value.ts].find((item) => typeof item === "string");
    return [{ room, topic, messages: typeof count === "number" ? count : 0, activeAt: typeof rawDate === "string" && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null }];
  });
}

function clean(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max)
    : "";
}
