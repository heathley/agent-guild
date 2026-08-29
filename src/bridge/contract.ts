export const BRIDGE_VERSION = "0.2.0" as const;

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
