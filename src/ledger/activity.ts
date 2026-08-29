import type { AgentBridgeEvent } from "../bridge/contract";
import type { AgentActivity, LedgerEntry } from "../protocol/models";

const PERSISTED_ACTIVITY = new Set<AgentActivity["event"]>([
  "mission.selected", "mission.researching", "mission.building", "mission.testing", "mission.blocked",
]);

export type ActivityRecordResult = {
  accepted: boolean;
  entries: LedgerEntry[];
  reason?: "unsupported-event" | "did-mismatch" | "missing-mission" | "mission-mismatch";
};

export function recordActivityFromEvent(entries: LedgerEntry[], event: AgentBridgeEvent, expectedDid: string | null): ActivityRecordResult {
  if (!PERSISTED_ACTIVITY.has(event.event as AgentActivity["event"])) return { accepted: false, entries, reason: "unsupported-event" };
  if (!expectedDid || event.identity.did !== expectedDid) return { accepted: false, entries, reason: "did-mismatch" };
  if (!event.mission?.id) return { accepted: false, entries, reason: "missing-mission" };
  const index = entries.findIndex((entry) => entry.mission.id === event.mission?.id);
  if (index < 0) return { accepted: false, entries, reason: "mission-mismatch" };
  const current = entries[index];
  if (current.activities?.some((item) => item.eventId === event.eventId) || current.lastActivity?.eventId === event.eventId) return { accepted: true, entries };
  const activity: AgentActivity = {
    eventId: event.eventId, event: event.event as AgentActivity["event"], agentDid: expectedDid, occurredAt: event.occurredAt,
  };
  const next = [...entries];
  const previous = current.activities?.length ? current.activities : current.lastActivity ? [current.lastActivity] : [];
  const activities = [...previous, activity]
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
    .slice(-50);
  const lastActivity = activities.at(-1) || activity;
  next[index] = { ...current, activities, lastActivity, updatedAt: lastActivity.occurredAt };
  return { accepted: true, entries: next };
}
