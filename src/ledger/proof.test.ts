import { describe, expect, it } from "vitest";
import type { AttachedEvidence } from "../protocol/models";
import { bindResultDigest, createEvidenceBundleDigest, messageContainsResultDigest, summarizeProofEvidence } from "./proof";

const evidence: AttachedEvidence[] = [
  { eventId: "test-1", missionId: "mission-1", kind: "test", agentDid: "did:key:test", source: "agent", attachedAt: "2026-08-30T00:00:00Z", digest: "sha256:test12345" },
  { eventId: "commit-1", missionId: "mission-1", kind: "commit", agentDid: "did:key:test", source: "agent", attachedAt: "2026-08-30T00:00:00Z", publicUrl: "https://github.com/heathley/agent-guild/commit/abc" },
];

describe("proof evidence bundle", () => {
  it("requires both an artifact and a check", () => {
    expect(summarizeProofEvidence(evidence).ready).toBe(true);
    expect(summarizeProofEvidence(evidence.slice(0, 1)).ready).toBe(false);
  });

  it("creates a stable digest independent of evidence order", async () => {
    const first = await createEvidenceBundleDigest("mission-1", evidence);
    const second = await createEvidenceBundleDigest("mission-1", [...evidence].reverse());
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it("binds the digest exactly once into the public result", () => {
    const digest = "sha256:1234567890abcdef";
    const bound = bindResultDigest("Built and tested the connector.", digest);
    expect(bound).toContain(`Result digest: ${digest}`);
    expect(bindResultDigest(bound, digest)).toBe(bound);
    expect(messageContainsResultDigest(bound, digest)).toBe(true);
  });
});
