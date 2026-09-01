import { describe, expect, it } from "vitest";
import { ASSIGNMENT_VERSION, BRIDGE_VERSION, DISCOVERY_REQUEST_VERSION, isAgentBridgeEvent, normalizeWorkspacePath, publicActionDestination, publicResultHasMission, sanitizeBridgePayload, sanitizeDiscoveryRequest, sanitizeMissionAssignment } from "./contract";

const event = {
  version: BRIDGE_VERSION,
  eventId: "evt_1",
  occurredAt: "2026-08-28T12:00:00.000Z",
  event: "mission.testing" as const,
  source: { adapter: "codex", agentLabel: "heathley" },
  identity: { did: null },
};

describe("Agent Bridge contract", () => {
  it("routes finished results to proof and conversation drafts to activity", () => {
    expect(publicActionDestination({ kind: "result", room: "technocore", exactText: "Finished and tested" })).toBe("proof");
    expect(publicActionDestination({ kind: "question", room: "technocore", exactText: "Can anyone reproduce this?" })).toBe("activity");
  });

  it("requires an explicit mission on finished-result events", () => {
    const result = { kind: "result" as const, room: "technocore", exactText: "Finished and tested" };
    expect(publicResultHasMission({ publicAction: result })).toBe(false);
    expect(publicResultHasMission({ publicAction: result, mission: { id: "local:1", title: "Check one flow" } })).toBe(true);
    expect(publicResultHasMission({ publicAction: { ...result, kind: "question" } })).toBe(true);
  });

  it("preserves the full allowlisted mission on a finished-result event", () => {
    const mission = {
      id: "local:1", source: "local" as const, title: "Check one flow", summary: "Confirm the result routing.",
      successCriteria: ["The result opens under this mission"], verification: "Inspect the Proof Workspace title.", risk: "low" as const,
      room: "d-agent-guild", sourceSeq: 1,
    };
    const safe = sanitizeBridgePayload({
      ...event, event: "approval.requested", mission,
      publicAction: { kind: "result", room: "d-agent-guild", exactText: "Finished and tested" },
    });
    expect(safe?.mission).toEqual(mission);
  });

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

  it("rebuilds mission assignments from a strict allowlist", () => {
    const assignment = {
      version: ASSIGNMENT_VERSION,
      assignmentId: "assignment_1234",
      createdAt: "2026-08-29T00:00:00.000Z",
      expiresAt: "2026-08-29T00:30:00.000Z",
      agentDid: `did:key:z6Mk${"a".repeat(44)}`,
      mission: {
        id: "local:1", source: "local", title: "Check one flow", summary: "Confirm the connector handoff.",
        successCriteria: ["The agent acknowledges the exact mission"], verification: "Observe signed relay lifecycle events.", risk: "low",
        prompt: "must not cross the bridge",
      },
      workspace: { requiredPath: "/Users/test/agent-work/", policy: "exact" },
      publicActions: "human-approval-required",
      environment: { SECRET: "must not cross the bridge" },
    };
    const safe = sanitizeMissionAssignment(assignment);
    expect(safe).not.toHaveProperty("environment");
    expect(safe?.mission).not.toHaveProperty("prompt");
    expect(safe?.workspace).toEqual({ requiredPath: "/Users/test/agent-work", policy: "exact" });
    expect(safe?.publicActions).toBe("human-approval-required");
  });

  it("rejects an assignment for an invalid DID or without a finish line", () => {
    const assignment = {
      version: ASSIGNMENT_VERSION, assignmentId: "assignment_1234",
      createdAt: "2026-08-29T00:00:00.000Z", expiresAt: "2026-08-29T00:30:00.000Z", agentDid: "did:key:wrong",
      mission: { id: "1", source: "local", title: "A", summary: "B", successCriteria: [], verification: "C", risk: "low" },
      workspace: { requiredPath: "../wrong", policy: "exact" },
      publicActions: "human-approval-required",
    };
    expect(sanitizeMissionAssignment(assignment)).toBeNull();
  });

  it("normalizes absolute workspace paths and rejects traversal", () => {
    expect(normalizeWorkspacePath("/Users/test/Flop-Friend/")).toBe("/Users/test/Flop-Friend");
    expect(normalizeWorkspacePath("C:\\Users\\test\\project\\")).toBe("c:/Users/test/project");
    expect(normalizeWorkspacePath("../Flop-Friend")).toBeNull();
    expect(normalizeWorkspacePath("/Users/test/../Flop")).toBeNull();
  });

  it("accepts only a normalized workspace offer and derives its friendly name", () => {
    const safe = sanitizeBridgePayload({ ...event, event: "workspace.offer", workspace: { path: "/Users/test/Flop-Friend/", name: "untrusted label" } });
    expect(safe?.workspace).toEqual({ path: "/Users/test/Flop-Friend", name: "Flop-Friend" });
    expect(sanitizeBridgePayload({ ...event, event: "workspace.offer", workspace: { path: "../wrong", name: "wrong" } })).toBeNull();
    expect(sanitizeBridgePayload({ ...event, event: "workspace.offer" })).toBeNull();
  });

  it("requires a workspace for autonomous work but not suggestion-only scans", () => {
    const base = {
      version: DISCOVERY_REQUEST_VERSION, requestId: "discovery_1234",
      createdAt: "2026-08-29T00:00:00.000Z", expiresAt: "2026-08-29T00:30:00.000Z",
      agentDid: `did:key:z6Mk${"a".repeat(44)}`, source: "all", skills: ["RESEARCH"], publicActions: "human-approval-required",
    };
    expect(sanitizeDiscoveryRequest({ ...base, mode: "suggest" })).not.toBeNull();
    expect(sanitizeDiscoveryRequest({ ...base, mode: "local-autonomy" })).toBeNull();
    expect(sanitizeDiscoveryRequest({ ...base, mode: "local-autonomy", workspace: { requiredPath: "/Users/test/work", policy: "exact" } })?.workspace?.requiredPath).toBe("/Users/test/work");
  });
});
