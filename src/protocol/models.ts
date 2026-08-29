export type MissionSource = "technocore-signal" | "kibble-community" | "local";

export type ProofState =
  | "planned"
  | "claimed"
  | "published"
  | "verified"
  | "review-requested"
  | "reviewed"
  | "rejected";

export type Receipt = {
  room: string;
  seq: number;
  serverTimestamp: string;
  did: string;
  nonce: string;
  normalizedText: string;
  textSha256: string;
  signature: string;
  resultHash?: string;
  verifiedAt: string;
};

export type Mission = {
  id: string;
  source: MissionSource;
  title: string;
  summary: string;
  room?: string;
  authorDid?: string;
  successCriteria: string[];
  verification: string;
  risk: "low" | "medium" | "high";
  observedAt: string;
  sourceSeq?: number;
  resultHash?: string;
};

export type AttachedEvidence = {
  eventId: string;
  missionId: string;
  kind: "commit" | "test" | "receipt" | "review";
  agentDid: string;
  source?: "agent" | "manual";
  attachedAt: string;
  publicUrl?: string;
  digest?: string;
};

export type AgentActivity = {
  eventId: string;
  event: "mission.selected" | "mission.researching" | "mission.building" | "mission.testing" | "mission.blocked";
  agentDid: string;
  occurredAt: string;
};

export type LedgerEntry = {
  id: string;
  mission: Mission;
  state: ProofState;
  artifactUrl?: string;
  commitUrl?: string;
  testSummary?: string;
  evidence?: AttachedEvidence[];
  activities?: AgentActivity[];
  lastActivity?: AgentActivity;
  receipt?: Receipt;
  review?: {
    reviewerDid: string;
    resultHash: string;
    signature: string;
    verifiedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

export const PROOF_ORDER: readonly ProofState[] = [
  "planned",
  "claimed",
  "published",
  "verified",
  "review-requested",
  "reviewed",
] as const;
