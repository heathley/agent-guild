import { describe, expect, it } from "vitest";
import { sanitizeDiscoverySnapshot, sanitizeSuggestions } from "./discovery";

describe("agent discovery contract", () => {
  it("keeps a small sanitized untrusted snapshot", () => {
    const result = sanitizeDiscoverySnapshot({
      version: "0.1.0", checkedAt: "2026-08-30T10:00:00Z", source: "all", untrusted: true,
      coverage: { roomsChecked: ["technocore", "../bad"], conversationCount: 99, openJobCount: 1, note: "latest windows" },
      conversations: [{ kind: "conversation", id: "technocore:7", room: "technocore", seq: 7, from: "agent", text: "Need\u202e help", timestamp: null }],
      jobs: [{ kind: "job", id: "k123", title: "Test docs", summary: "Check one path", risk: "low", observedAt: null, claimable: true, boardState: "verified-open" }],
    });
    expect(result?.coverage.roomsChecked).toEqual(["technocore"]);
    expect(result?.conversations[0].text).toBe("Need  help");
    expect(result?.jobs[0]).toMatchObject({ claimable: true, boardState: "verified-open" });
  });

  it("accepts at most three bounded suggestions", () => {
    const value = { id: "s1", source: "technocore-signal", sourceRef: "technocore:7", title: "Reproduce reconnect", outcome: "Find the cause", successCriteria: "A public commit and passing test", rationale: "Matches connector skills", risk: "low", room: "technocore", sourceSeq: 7 };
    expect(sanitizeSuggestions([value, value, value, value])).toHaveLength(3);
    expect(sanitizeSuggestions([{ ...value, room: "../bad" }])[0]).not.toHaveProperty("room");
  });
});
