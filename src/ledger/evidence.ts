import type { AgentBridgeEvent } from "../bridge/contract";
import type { AttachedEvidence, LedgerEntry } from "../protocol/models";

export type EvidenceAttachResult = {
  accepted: boolean;
  entries: LedgerEntry[];
  reason?: "missing-evidence" | "did-mismatch" | "missing-mission" | "mission-mismatch" | "invalid-reference";
};

export function attachEvidenceFromEvent(entries: LedgerEntry[], event: AgentBridgeEvent, expectedDid: string | null): EvidenceAttachResult {
  if (!event.evidence) return { accepted: false, entries, reason: "missing-evidence" };
  if (!expectedDid || event.identity.did !== expectedDid) return { accepted: false, entries, reason: "did-mismatch" };
  if (!event.mission?.id) return { accepted: false, entries, reason: "missing-mission" };
  const index = entries.findIndex((entry) => entry.mission.id === event.mission?.id);
  if (index < 0) return { accepted: false, entries, reason: "mission-mismatch" };
  if (!validReference(event.evidence.publicUrl, event.evidence.digest)) return { accepted: false, entries, reason: "invalid-reference" };

  const current = entries[index];
  if (current.evidence?.some((item) => item.eventId === event.eventId)) return { accepted: true, entries };
  const evidence: AttachedEvidence = {
    eventId: event.eventId,
    missionId: event.mission.id,
    kind: event.evidence.kind,
    agentDid: expectedDid,
    source: "agent",
    attachedAt: event.occurredAt,
    ...(event.evidence.publicUrl ? { publicUrl: event.evidence.publicUrl } : {}),
    ...(event.evidence.digest ? { digest: event.evidence.digest } : {}),
  };
  const next = [...entries];
  next[index] = { ...current, evidence: [...(current.evidence || []), evidence], updatedAt: event.occurredAt };
  return { accepted: true, entries: next };
}

export function attachManualEvidence(
  entries: LedgerEntry[],
  missionId: string,
  expectedDid: string | null,
  kind: AttachedEvidence["kind"],
  reference: string,
): EvidenceAttachResult {
  if (!expectedDid) return { accepted: false, entries, reason: "did-mismatch" };
  const index = entries.findIndex((entry) => entry.mission.id === missionId);
  if (index < 0) return { accepted: false, entries, reason: "mission-mismatch" };
  const trimmed = reference.trim();
  const isUrl = (() => { try { return new URL(trimmed).protocol === "https:"; } catch { return false; } })();
  if (!validReference(isUrl ? trimmed : undefined, isUrl ? undefined : trimmed)) return { accepted: false, entries, reason: "invalid-reference" };
  const now = new Date().toISOString();
  const evidence: AttachedEvidence = {
    eventId: crypto.randomUUID(), missionId, kind, agentDid: expectedDid, source: "manual", attachedAt: now,
    ...(isUrl ? { publicUrl: trimmed } : { digest: trimmed }),
  };
  const next = [...entries];
  const current = entries[index];
  next[index] = { ...current, evidence: [...(current.evidence || []), evidence], updatedAt: now };
  return { accepted: true, entries: next };
}

function validReference(publicUrl?: string, digest?: string): boolean {
  if (digest && /^[A-Za-z0-9:_-]{8,160}$/.test(digest)) return true;
  if (!publicUrl) return false;
  try { return new URL(publicUrl).protocol === "https:"; } catch { return false; }
}
