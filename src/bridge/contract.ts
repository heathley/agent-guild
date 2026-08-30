import { sanitizeSuggestions, type AutonomyMode, type DiscoverySource, type WorkSuggestion } from "./discovery.js";

export const BRIDGE_VERSION = "0.3.0" as const;
export const ASSIGNMENT_VERSION = "0.2.0" as const;
export const DISCOVERY_REQUEST_VERSION = "0.2.0" as const;
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

export const AGENT_EVENTS = [
  "agent.connected", "agent.idle", "mission.scanning", "mission.selected", "mission.suggestions",
  "mission.researching", "mission.building", "mission.testing", "mission.blocked",
  "approval.requested", "proof.published", "proof.verified", "review.requested",
] as const;

export type AgentEventName = (typeof AGENT_EVENTS)[number];
export type BridgeMission = {
  id: string;
  title: string;
  source?: "technocore-signal" | "kibble-community" | "local";
  summary?: string;
  successCriteria?: string[];
  verification?: string;
  risk?: "low" | "medium" | "high";
  room?: string;
  sourceSeq?: number;
};
export type PublicActionDraft = {
  kind: "reply" | "question" | "help" | "progress" | "claim" | "result" | "review";
  room: string;
  exactText: string;
  replyToSeq?: number;
};
export type AgentBridgeEvent = {
  version: typeof BRIDGE_VERSION;
  eventId: string;
  occurredAt: string;
  event: AgentEventName;
  source: { adapter: string; agentLabel: string };
  identity: { did: string | null };
  mission?: BridgeMission;
  evidence?: { kind: "commit" | "test" | "receipt" | "review"; publicUrl?: string; digest?: string };
  discovery?: { source: DiscoverySource; checkedAt: string; conversationCount: number; openJobCount: number };
  suggestions?: WorkSuggestion[];
  publicAction?: PublicActionDraft;
  detail?: string;
};

export type MissionAssignment = {
  version: typeof ASSIGNMENT_VERSION;
  assignmentId: string;
  createdAt: string;
  expiresAt: string;
  agentDid: string;
  mission: {
    id: string;
    source: "technocore-signal" | "kibble-community" | "local";
    title: string;
    summary: string;
    successCriteria: string[];
    verification: string;
    risk: "low" | "medium" | "high";
    room?: string;
  };
  workspace: {
    requiredPath: string;
    policy: "exact";
  };
  publicActions: "human-approval-required";
};

export type DiscoveryRequest = {
  version: typeof DISCOVERY_REQUEST_VERSION;
  requestId: string;
  createdAt: string;
  expiresAt: string;
  agentDid: string;
  source: DiscoverySource;
  mode: AutonomyMode;
  skills: string[];
  workspace?: { requiredPath: string; policy: "exact" };
  publicActions: "human-approval-required";
};

export type ConnectorCommand = MissionAssignment | DiscoveryRequest;

export function sanitizeMissionAssignment(input: unknown): MissionAssignment | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<MissionAssignment>;
  const mission = value.mission;
  if (value.version !== ASSIGNMENT_VERSION || typeof value.assignmentId !== "string" || value.assignmentId.length < 8 || value.assignmentId.length > 96 ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt) ||
      typeof value.agentDid !== "string" || !/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/.test(value.agentDid) ||
      value.publicActions !== "human-approval-required" || !mission ||
      typeof mission.id !== "string" || typeof mission.title !== "string" || typeof mission.summary !== "string" ||
      !["technocore-signal", "kibble-community", "local"].includes(mission.source as string) ||
      !Array.isArray(mission.successCriteria) || mission.successCriteria.length < 1 || mission.successCriteria.length > 8 ||
      mission.successCriteria.some((item) => typeof item !== "string" || !item.trim() || item.length > 500) ||
      typeof mission.verification !== "string" || !["low", "medium", "high"].includes(mission.risk as string) ||
      (mission.room !== undefined && (typeof mission.room !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(mission.room))) ||
      !value.workspace || value.workspace.policy !== "exact" || !normalizeWorkspacePath(value.workspace.requiredPath)
  ) return null;
  return {
    version: ASSIGNMENT_VERSION,
    assignmentId: clean(value.assignmentId, 96),
    createdAt: new Date(value.createdAt).toISOString(),
    expiresAt: new Date(value.expiresAt).toISOString(),
    agentDid: value.agentDid,
    mission: {
      id: clean(mission.id, 96), source: mission.source, title: clean(mission.title, 160), summary: clean(mission.summary, 500),
      successCriteria: mission.successCriteria.map((item) => clean(item, 500)),
      verification: clean(mission.verification, 500), risk: mission.risk,
      ...(mission.room ? { room: mission.room } : {}),
    },
    workspace: { requiredPath: normalizeWorkspacePath(value.workspace.requiredPath)!, policy: "exact" },
    publicActions: "human-approval-required",
  };
}

export function normalizeWorkspacePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().replaceAll("\\", "/");
  if (!value || value.length > 1024 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) return null;
  const absolute = value.startsWith("/") || /^[A-Za-z]:\//.test(value);
  if (!absolute || value.split("/").some((part) => part === "." || part === "..")) return null;
  const collapsed = value.replace(/\/{2,}/g, "/");
  const normalized = collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
  return /^[A-Za-z]:\//.test(normalized) ? `${normalized[0].toLowerCase()}${normalized.slice(1)}` : normalized;
}

export function sanitizeDiscoveryRequest(input: unknown): DiscoveryRequest | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<DiscoveryRequest>;
  if (value.version !== DISCOVERY_REQUEST_VERSION || typeof value.requestId !== "string" || value.requestId.length < 8 || value.requestId.length > 96 ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt) || typeof value.agentDid !== "string" || !DID.test(value.agentDid) ||
      !["all", "technocore", "kibble"].includes(value.source || "") || !["suggest", "local-autonomy"].includes(value.mode || "") ||
      !Array.isArray(value.skills) || value.skills.length > 8 || value.skills.some((item) => typeof item !== "string" || !item.trim() || item.length > 40) ||
      (value.workspace !== undefined && (value.workspace.policy !== "exact" || !normalizeWorkspacePath(value.workspace.requiredPath))) ||
      (value.mode === "local-autonomy" && !value.workspace) ||
      value.publicActions !== "human-approval-required") return null;
  return { version: DISCOVERY_REQUEST_VERSION, requestId: clean(value.requestId, 96), createdAt: new Date(value.createdAt).toISOString(), expiresAt: new Date(value.expiresAt).toISOString(),
    agentDid: value.agentDid, source: value.source as DiscoverySource, mode: value.mode as AutonomyMode, skills: value.skills.map((item) => clean(item, 40)),
    ...(value.workspace ? { workspace: { requiredPath: normalizeWorkspacePath(value.workspace.requiredPath)!, policy: "exact" as const } } : {}),
    publicActions: "human-approval-required" };
}

export function sanitizeConnectorCommand(input: unknown): ConnectorCommand | null {
  return sanitizeMissionAssignment(input) || sanitizeDiscoveryRequest(input);
}

// Unknown input is rejected. Accepted input is rebuilt from an explicit allowlist,
// so raw prompts, environment values and terminal output cannot hitch a ride.
export function sanitizeBridgePayload(input: unknown): AgentBridgeEvent | null {
  if (!isAgentBridgeEvent(input)) return null;
  const value = input as AgentBridgeEvent;
  return {
    version: BRIDGE_VERSION,
    eventId: clean(value.eventId, 96),
    occurredAt: new Date(value.occurredAt).toISOString(),
    event: value.event,
    source: { adapter: clean(value.source.adapter, 48), agentLabel: clean(value.source.agentLabel, 64) },
    identity: { did: value.identity.did ? clean(value.identity.did, 180) : null },
    ...(value.mission ? { mission: sanitizeMission(value.mission) } : {}),
    ...(value.evidence ? { evidence: {
      kind: value.evidence.kind,
      ...(value.evidence.publicUrl ? { publicUrl: clean(value.evidence.publicUrl, 500) } : {}),
      ...(value.evidence.digest ? { digest: clean(value.evidence.digest, 160) } : {}),
    } } : {}),
    ...(value.discovery ? { discovery: {
      source: value.discovery.source,
      checkedAt: new Date(value.discovery.checkedAt).toISOString(),
      conversationCount: value.discovery.conversationCount,
      openJobCount: value.discovery.openJobCount,
    } } : {}),
    ...(value.suggestions ? { suggestions: sanitizeSuggestions(value.suggestions) } : {}),
    ...(value.publicAction ? { publicAction: {
      kind: value.publicAction.kind,
      room: value.publicAction.room,
      exactText: clean(value.publicAction.exactText, 4096),
      ...(Number.isSafeInteger(value.publicAction.replyToSeq) ? { replyToSeq: value.publicAction.replyToSeq } : {}),
    } } : {}),
    ...(value.detail ? { detail: clean(value.detail, 500) } : {}),
  };
}

export function isAgentBridgeEvent(input: unknown): input is AgentBridgeEvent {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<AgentBridgeEvent>;
  return value.version === BRIDGE_VERSION &&
    typeof value.eventId === "string" && value.eventId.length > 0 && value.eventId.length <= 96 &&
    typeof value.occurredAt === "string" && Number.isFinite(Date.parse(value.occurredAt)) &&
    typeof value.event === "string" && AGENT_EVENTS.includes(value.event as AgentEventName) &&
    typeof value.source?.adapter === "string" && value.source.adapter.length > 0 && value.source.adapter.length <= 48 &&
    typeof value.source?.agentLabel === "string" && value.source.agentLabel.length > 0 && value.source.agentLabel.length <= 64 &&
    (typeof value.identity?.did === "string" || value.identity?.did === null) &&
    (!value.mission || validMission(value.mission)) &&
    (!value.evidence || (["commit", "test", "receipt", "review"].includes(value.evidence.kind) &&
      (value.evidence.publicUrl === undefined || typeof value.evidence.publicUrl === "string") &&
      (value.evidence.digest === undefined || typeof value.evidence.digest === "string"))) &&
    (!value.discovery || (["all", "technocore", "kibble"].includes(value.discovery.source) && Number.isFinite(Date.parse(value.discovery.checkedAt)) && Number.isSafeInteger(value.discovery.conversationCount) && Number.isSafeInteger(value.discovery.openJobCount))) &&
    (!value.suggestions || (Array.isArray(value.suggestions) && sanitizeSuggestions(value.suggestions).length === value.suggestions.length)) &&
    (!value.publicAction || (["reply", "question", "help", "progress", "claim", "result", "review"].includes(value.publicAction.kind) && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(value.publicAction.room) && typeof value.publicAction.exactText === "string" && value.publicAction.exactText.length > 0 && value.publicAction.exactText.length <= 4096 && (value.publicAction.replyToSeq === undefined || Number.isSafeInteger(value.publicAction.replyToSeq)))) &&
    (value.detail === undefined || (typeof value.detail === "string" && value.detail.length <= 500));
}

function validMission(value: BridgeMission): boolean {
  return typeof value.id === "string" && typeof value.title === "string" &&
    (value.source === undefined || ["technocore-signal", "kibble-community", "local"].includes(value.source)) &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.successCriteria === undefined || (Array.isArray(value.successCriteria) && value.successCriteria.length <= 8 && value.successCriteria.every((item) => typeof item === "string" && item.length <= 500))) &&
    (value.verification === undefined || typeof value.verification === "string") &&
    (value.risk === undefined || ["low", "medium", "high"].includes(value.risk)) &&
    (value.room === undefined || /^[a-z0-9][a-z0-9_-]{0,47}$/.test(value.room)) &&
    (value.sourceSeq === undefined || Number.isSafeInteger(value.sourceSeq));
}

function sanitizeMission(value: BridgeMission): BridgeMission {
  return {
    id: clean(value.id, 96), title: clean(value.title, 160),
    ...(value.source ? { source: value.source } : {}),
    ...(value.summary ? { summary: clean(value.summary, 500) } : {}),
    ...(value.successCriteria ? { successCriteria: value.successCriteria.map((item) => clean(item, 500)).slice(0, 8) } : {}),
    ...(value.verification ? { verification: clean(value.verification, 500) } : {}),
    ...(value.risk ? { risk: value.risk } : {}),
    ...(value.room ? { room: value.room } : {}),
    ...(Number.isSafeInteger(value.sourceSeq) ? { sourceSeq: value.sourceSeq } : {}),
  };
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max);
}
