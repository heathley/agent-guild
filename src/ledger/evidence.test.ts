import { describe, expect, it } from "vitest";
import { BRIDGE_VERSION, type AgentBridgeEvent } from "../bridge/contract";
import type { LedgerEntry } from "../protocol/models";
import { attachEvidenceFromEvent } from "./evidence";

const did = "did:key:z6MkevNrxH1t5ZwJ6nTwEPsSEH4ath6Si5WRFrafM8AynvBq";
const entry: LedgerEntry = {
  id: "entry-1", state: "planned", createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
  mission: { id: "mission-1", source: "local", title: "Evidence persistence", summary: "Store safe evidence", successCriteria: ["Survives reload"], verification: "Ledger read-back", risk: "low", observedAt: "2026-08-29T00:00:00.000Z" },
};
const event: AgentBridgeEvent = {
  version: BRIDGE_VERSION, eventId: "event-evidence-1", occurredAt: "2026-08-29T01:00:00.000Z", event: "mission.testing",
  source: { adapter: "codex", agentLabel: "heathley" }, identity: { did }, mission: { id: "mission-1", title: "Evidence persistence" },
  evidence: { kind: "test", digest: "sha256:1234567890abcdef" },
};

describe("agent evidence ledger attachment", () => {
  it("stores allowlisted evidence without advancing proof state", () => {
    const result = attachEvidenceFromEvent([entry], event, did);
    expect(result.accepted).toBe(true);
    expect(result.entries[0].state).toBe("planned");
    expect(result.entries[0].evidence).toEqual([{
      eventId: "event-evidence-1", missionId: "mission-1", kind: "test", agentDid: did,
      attachedAt: "2026-08-29T01:00:00.000Z", digest: "sha256:1234567890abcdef",
    }]);
  });

  it("rejects a different DID or mission", () => {
    expect(attachEvidenceFromEvent([entry], event, `${did}x`).reason).toBe("did-mismatch");
    expect(attachEvidenceFromEvent([entry], { ...event, mission: { id: "other", title: "Other" } }, did).reason).toBe("mission-mismatch");
  });

  it("deduplicates replayed events", () => {
    const once = attachEvidenceFromEvent([entry], event, did).entries;
    const twice = attachEvidenceFromEvent(once, event, did).entries;
    expect(twice[0].evidence).toHaveLength(1);
  });

  it("requires a safe digest or HTTPS URL", () => {
    const unsafe = { ...event, evidence: { kind: "test" as const, publicUrl: "http://localhost/result" } };
    expect(attachEvidenceFromEvent([entry], unsafe, did).reason).toBe("invalid-reference");
  });
});
