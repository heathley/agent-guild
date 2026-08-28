export const BRIDGE_VERSION = "0.1.0" as const;

export const AGENT_EVENTS = [
  "agent.connected",
  "agent.idle",
  "mission.scanning",
  "mission.selected",
  "mission.researching",
  "mission.building",
  "mission.testing",
  "mission.blocked",
  "approval.requested",
  "proof.published",
  "proof.verified",
  "review.requested",
] as const;

export type AgentEventName = (typeof AGENT_EVENTS)[number];

export type AgentBridgeEvent = {
  version: typeof BRIDGE_VERSION;
  eventId: string;
  occurredAt: string;
  event: AgentEventName;
  source: {
    adapter: string;
    agentLabel: string;
  };
  identity: {
    did: string | null;
  };
  mission?: {
    id: string;
    title: string;
  };
  evidence?: {
    kind: "commit" | "test" | "receipt" | "review";
    publicUrl?: string;
    digest?: string;
  };
  detail?: string;
};

const SECRET_FIELDS = new Set([
  "privatekey",
  "private_key",
  "passphrase",
  "password",
  "apikey",
  "api_key",
  "token",
  "secret",
  "seed",
]);

export function sanitizeBridgePayload(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sanitizeBridgePayload);
  if (!input || typeof input !== "object") return input;

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key]) => !SECRET_FIELDS.has(key.toLowerCase()))
      .map(([key, value]) => [key, sanitizeBridgePayload(value)]),
  );
}

export function isAgentBridgeEvent(input: unknown): input is AgentBridgeEvent {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<AgentBridgeEvent>;
  return (
    value.version === BRIDGE_VERSION &&
    typeof value.eventId === "string" &&
    typeof value.occurredAt === "string" &&
    typeof value.event === "string" &&
    AGENT_EVENTS.includes(value.event as AgentEventName) &&
    typeof value.source?.adapter === "string" &&
    typeof value.source?.agentLabel === "string" &&
    (typeof value.identity?.did === "string" || value.identity?.did === null)
  );
}
