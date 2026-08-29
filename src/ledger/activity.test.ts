import { describe, expect, it } from "vitest";
import { BRIDGE_VERSION, type AgentBridgeEvent } from "../bridge/contract";
import type { LedgerEntry } from "../protocol/models";
import { recordActivityFromEvent } from "./activity";

const did = "did:key:z6MkevNrxH1t5ZwJ6nTwEPsSEH4ath6Si5WRFrafM8AynvBq";
const entry: LedgerEntry = {
  id: "entry-1", state: "planned", createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
  mission: { id: "mission-1", source: "local", title: "Lifecycle", summary: "Persist activity", successCriteria: ["Reload stays at MAKE IT"], verification: "Ledger read-back", risk: "low", observedAt: "2026-08-29T00:00:00.000Z" },
};
const researching: AgentBridgeEvent = {
  version: BRIDGE_VERSION, eventId: "activity-1", occurredAt: "2026-08-29T01:00:00.000Z", event: "mission.researching",
  source: { adapter: "codex", agentLabel: "heathley" }, identity: { did }, mission: { id: "mission-1", title: "Lifecycle" },
};

describe("agent lifecycle persistence", () => {
  it("stores activity without advancing planned proof", () => {
    const result = recordActivityFromEvent([entry], researching, did);
    expect(result.accepted).toBe(true);
    expect(result.entries[0].state).toBe("planned");
    expect(result.entries[0].lastActivity?.event).toBe("mission.researching");
  });

  it("rejects a different DID or mission", () => {
    expect(recordActivityFromEvent([entry], researching, `${did}x`).reason).toBe("did-mismatch");
    expect(recordActivityFromEvent([entry], { ...researching, mission: { id: "other", title: "Other" } }, did).reason).toBe("mission-mismatch");
  });

  it("does not let an older replay replace newer activity", () => {
    const testing = { ...researching, eventId: "activity-2", occurredAt: "2026-08-29T02:00:00.000Z", event: "mission.testing" as const };
    const newest = recordActivityFromEvent([entry], testing, did).entries;
    const replayed = recordActivityFromEvent(newest, researching, did).entries;
    expect(replayed[0].lastActivity?.event).toBe("mission.testing");
  });
});
