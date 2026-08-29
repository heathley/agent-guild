import { describe, expect, it } from "vitest";
import { BRIDGE_VERSION, isAgentBridgeEvent, sanitizeBridgePayload } from "./contract";

const event = {
  version: BRIDGE_VERSION,
  eventId: "evt_1",
  occurredAt: "2026-08-28T12:00:00.000Z",
  event: "mission.testing" as const,
  source: { adapter: "codex", agentLabel: "heathley" },
  identity: { did: null },
};

describe("Agent Bridge contract", () => {
  it("accepts a model-neutral lifecycle event", () => {
    expect(isAgentBridgeEvent(event)).toBe(true);
    expect(sanitizeBridgePayload(event)).toEqual(event);
  });

  it("rejects unknown event types", () => {
    expect(isAgentBridgeEvent({ ...event, event: "message.autoposted" })).toBe(false);
  });

  it("rejects arbitrary input instead of trying to redact unknown fields", () => {
    expect(sanitizeBridgePayload({ token: "never-export-this", nested: { test: "passed" } })).toBeNull();
  });
});
