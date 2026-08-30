import type { AttachedEvidence } from "../protocol/models";

export type ProofEvidenceSummary = {
  artifact: AttachedEvidence | null;
  check: AttachedEvidence | null;
  ready: boolean;
};

export function summarizeProofEvidence(evidence: AttachedEvidence[] = []): ProofEvidenceSummary {
  const artifact = evidence.find((item) => item.kind === "commit") || null;
  const check = evidence.find((item) => item.kind === "test") || null;
  return { artifact, check, ready: Boolean(artifact && check) };
}

export async function createEvidenceBundleDigest(missionId: string, evidence: AttachedEvidence[] = []): Promise<string | null> {
  const summary = summarizeProofEvidence(evidence);
  if (!summary.ready) return null;
  const canonical = evidence
    .filter((item) => item.kind === "commit" || item.kind === "test")
    .map((item) => ({ kind: item.kind, reference: item.digest || item.publicUrl || "" }))
    .filter((item) => item.reference)
    .sort((left, right) => `${left.kind}:${left.reference}`.localeCompare(`${right.kind}:${right.reference}`));
  const manifest = JSON.stringify({ version: 1, missionId, evidence: canonical });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(manifest));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function bindResultDigest(message: string, resultDigest: string): string {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Describe what was made and what was actually checked.");
  return trimmed.includes(resultDigest) ? trimmed : `${trimmed}\nResult digest: ${resultDigest}`;
}

export function messageContainsResultDigest(message: string, resultDigest: string): boolean {
  return Boolean(resultDigest && message.includes(resultDigest));
}
