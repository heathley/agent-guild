export const BRIDGE_VERSION = "0.2.0" as const;
export const ASSIGNMENT_VERSION = "0.1.0" as const;

export const AGENT_EVENTS = [
  "agent.connected", "agent.idle", "mission.scanning", "mission.selected",
  "mission.researching", "mission.building", "mission.testing", "mission.blocked",
  "approval.requested", "proof.published", "proof.verified", "review.requested",
] as const;

export type AgentEventName = (typeof AGENT_EVENTS)[number];
export type AgentBridgeEvent = {
  version: typeof BRIDGE_VERSION;
  eventId: string;
  occurredAt: string;
  event: AgentEventName;
  source: { adapter: string; agentLabel: string };
  identity: { did: string | null };
  mission?: { id: string; title: string };
  evidence?: { kind: "commit" | "test" | "receipt" | "review"; publicUrl?: string; digest?: string };
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
  publicActions: "human-approval-required";
};

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
      (mission.room !== undefined && (typeof mission.room !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(mission.room)))
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
    publicActions: "human-approval-required",
  };
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
    ...(value.mission ? { mission: { id: clean(value.mission.id, 96), title: clean(value.mission.title, 160) } } : {}),
    ...(value.evidence ? { evidence: {
      kind: value.evidence.kind,
      ...(value.evidence.publicUrl ? { publicUrl: clean(value.evidence.publicUrl, 500) } : {}),
      ...(value.evidence.digest ? { digest: clean(value.evidence.digest, 160) } : {}),
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
    (!value.mission || (typeof value.mission.id === "string" && typeof value.mission.title === "string")) &&
    (!value.evidence || (["commit", "test", "receipt", "review"].includes(value.evidence.kind) &&
      (value.evidence.publicUrl === undefined || typeof value.evidence.publicUrl === "string") &&
      (value.evidence.digest === undefined || typeof value.evidence.digest === "string"))) &&
    (value.detail === undefined || (typeof value.detail === "string" && value.detail.length <= 500));
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max);
}
