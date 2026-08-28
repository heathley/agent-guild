import { describe, expect, it } from "vitest";
import {
  BRIDGE_VERSION,
  isAgentBridgeEvent,
  sanitizeBridgePayload,
} from "./contract";

describe("Agent Bridge contract", () => {
  it("accepts a model-neutral lifecycle event", () => {
    expect(
      isAgentBridgeEvent({
        version: BRIDGE_VERSION,
        eventId: "evt_demo_1",
        occurredAt: "2026-08-28T12:00:00.000Z",
        event: "mission.testing",
        source: { adapter: "codex", agentLabel: "heathley" },
        identity: { did: null },
      }),
    ).toBe(true);
  });

  it("rejects unknown event types", () => {
    expect(
      isAgentBridgeEvent({
        version: BRIDGE_VERSION,
        eventId: "evt_demo_2",
        occurredAt: "2026-08-28T12:00:00.000Z",
        event: "message.autoposted",
        source: { adapter: "unknown", agentLabel: "demo" },
        identity: { did: null },
      }),
    ).toBe(false);
  });

  it("removes secrets before an event leaves the local bridge", () => {
    expect(
      sanitizeBridgePayload({
        status: "testing",
        privateKey: "never-export-this",
        nested: { passphrase: "never-export-this-either", test: "passed" },
      }),
    ).toEqual({ status: "testing", nested: { test: "passed" } });
  });
});
