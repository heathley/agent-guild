export const DISCOVERY_VERSION = "0.1.0" as const;

export type DiscoverySource = "all" | "technocore" | "kibble";
export type AutonomyMode = "suggest" | "local-autonomy";

export type ConversationCandidate = {
  kind: "conversation";
  id: string;
  room: string;
  seq: number;
  from: string;
  text: string;
  timestamp: string | null;
};

export type JobCandidate = {
  kind: "job";
  id: string;
  title: string;
  summary: string;
  authorDid?: string;
  risk: "low" | "medium" | "high";
  observedAt: string | null;
};

export type DiscoverySnapshot = {
  version: typeof DISCOVERY_VERSION;
  checkedAt: string;
  source: DiscoverySource;
  untrusted: true;
  coverage: {
    roomsChecked: string[];
    conversationCount: number;
    openJobCount: number;
    note: string;
  };
  conversations: ConversationCandidate[];
  jobs: JobCandidate[];
};

export type WorkSuggestion = {
  id: string;
  source: "technocore-signal" | "kibble-community";
  sourceRef: string;
  title: string;
  outcome: string;
  successCriteria: string;
  rationale: string;
  risk: "low" | "medium" | "high";
  room?: string;
  sourceSeq?: number;
};

export function sanitizeDiscoverySnapshot(input: unknown): DiscoverySnapshot | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<DiscoverySnapshot>;
  if (value.version !== DISCOVERY_VERSION || !["all", "technocore", "kibble"].includes(value.source || "") || value.untrusted !== true ||
      typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt)) || !value.coverage ||
      !Array.isArray(value.coverage.roomsChecked) || !Number.isInteger(value.coverage.conversationCount) || !Number.isInteger(value.coverage.openJobCount) ||
      typeof value.coverage.note !== "string" || !Array.isArray(value.conversations) || !Array.isArray(value.jobs)) return null;
  const roomsChecked = value.coverage.roomsChecked.map((item) => clean(item, 48)).filter((item) => ROOM.test(item)).slice(0, 8);
  const conversations = value.conversations.flatMap((item) => sanitizeConversation(item)).slice(0, 60);
  const jobs = value.jobs.flatMap((item) => sanitizeJob(item)).slice(0, 30);
  return {
    version: DISCOVERY_VERSION,
    checkedAt: new Date(value.checkedAt).toISOString(),
    source: value.source as DiscoverySource,
    untrusted: true,
    coverage: {
      roomsChecked,
      conversationCount: conversations.length,
      openJobCount: jobs.length,
      note: clean(value.coverage.note, 300),
    },
    conversations,
    jobs,
  };
}

export function sanitizeSuggestions(input: unknown): WorkSuggestion[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => sanitizeSuggestion(item)).slice(0, 3);
}

const ROOM = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

function sanitizeConversation(input: unknown): ConversationCandidate[] {
  if (!input || typeof input !== "object") return [];
  const value = input as Partial<ConversationCandidate>;
  const room = clean(value.room, 48);
  const text = clean(value.text, 1_200);
  if (value.kind !== "conversation" || !ROOM.test(room) || !Number.isSafeInteger(value.seq) || !text) return [];
  return [{
    kind: "conversation",
    id: clean(value.id, 120) || `${room}:${value.seq}`,
    room,
    seq: value.seq as number,
    from: clean(value.from, 180) || "unknown",
    text,
    timestamp: typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp)) ? new Date(value.timestamp).toISOString() : null,
  }];
}

function sanitizeJob(input: unknown): JobCandidate[] {
  if (!input || typeof input !== "object") return [];
  const value = input as Partial<JobCandidate>;
  const id = clean(value.id, 96);
  const title = clean(value.title, 160);
  const summary = clean(value.summary, 1_500);
  if (value.kind !== "job" || !id || !title || !summary || !["low", "medium", "high"].includes(value.risk || "")) return [];
  const authorDid = clean(value.authorDid, 180);
  return [{ kind: "job", id, title, summary, risk: value.risk as JobCandidate["risk"],
    ...(DID.test(authorDid) ? { authorDid } : {}),
    observedAt: typeof value.observedAt === "string" && Number.isFinite(Date.parse(value.observedAt)) ? new Date(value.observedAt).toISOString() : null }];
}

function sanitizeSuggestion(input: unknown): WorkSuggestion[] {
  if (!input || typeof input !== "object") return [];
  const value = input as Partial<WorkSuggestion>;
  const source = value.source;
  const room = clean(value.room, 48);
  if (!["technocore-signal", "kibble-community"].includes(source || "") ||
      !["low", "medium", "high"].includes(value.risk || "")) return [];
  const suggestion = {
    id: clean(value.id, 96), source: source as WorkSuggestion["source"], sourceRef: clean(value.sourceRef, 160),
    title: clean(value.title, 160), outcome: clean(value.outcome, 500), successCriteria: clean(value.successCriteria, 500),
    rationale: clean(value.rationale, 500), risk: value.risk as WorkSuggestion["risk"],
    ...(ROOM.test(room) ? { room } : {}),
    ...(Number.isSafeInteger(value.sourceSeq) ? { sourceSeq: value.sourceSeq } : {}),
  };
  return suggestion.id && suggestion.sourceRef && suggestion.title && suggestion.outcome && suggestion.successCriteria && suggestion.rationale ? [suggestion] : [];
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max) : "";
}
