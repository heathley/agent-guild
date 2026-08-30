const JOB_ID = /^k[0-9a-f]{10}$/;
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

export type KibbleJobState = {
  jobId: string;
  status: string;
  posterDid: string;
  workerDid: string;
  resultHash: string;
  resultText: string;
};

export function kibbleJobId(missionId: string): string | null {
  const value = missionId.startsWith("kibble:") ? missionId.slice(7) : missionId;
  return JOB_ID.test(value) ? value : null;
}

export function createKibbleClaim(jobId: string): string {
  assertJob(jobId);
  return `CLAIM v1 | ${jobId} | worker`;
}

export function createKibbleResult(jobId: string, summary: string): string {
  assertJob(jobId);
  const value = clean(summary, 3_800);
  if (!value) throw new Error("Kibble RESULT needs a concrete delivery summary.");
  return `RESULT v1 | ${jobId} | ${value}`;
}

export function createKibbleAttest(jobId: string, resultHash: string, useful: boolean, reason: string): string {
  assertJob(jobId);
  const hash = clean(resultHash, 160);
  const explanation = clean(reason, 1_000);
  if (!hash || !explanation) throw new Error("Kibble ATTEST needs the exact board result hash and a specific reason.");
  return `ATTEST v1 | ${jobId} | ${useful ? "useful" : "not"} | rh:${hash} | ${explanation}`;
}

export function findKibbleJob(input: unknown, expectedJobId: string): KibbleJobState | null {
  assertJob(expectedJobId);
  const rows = extractRows(input);
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const jobId = clean(value.job_id ?? value.id, 96);
    if (jobId !== expectedJobId) continue;
    return {
      jobId,
      status: clean(value.status, 32).toLowerCase(),
      posterDid: validDid(value.poster_did),
      workerDid: validDid(value.worker_did),
      resultHash: clean(value.result_hash, 160),
      resultText: clean(value.result_text ?? value.result ?? value.delivery, 4_096),
    };
  }
  return null;
}

export function claimIsBoardVerified(job: KibbleJobState | null, workerDid: string): boolean {
  return Boolean(job && DID.test(workerDid) && job.workerDid === workerDid && ["claimed", "delivered", "result", "attested"].includes(job.status));
}

export function resultIsBoardVerified(job: KibbleJobState | null, workerDid: string): boolean {
  return Boolean(job && claimIsBoardVerified(job, workerDid) && job.resultHash);
}

function extractRows(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];
  const value = input as Record<string, unknown>;
  for (const key of ["jobs", "board", "items", "data"]) if (Array.isArray(value[key])) return value[key] as unknown[];
  return [];
}

function validDid(value: unknown): string {
  const did = clean(value, 180);
  return DID.test(did) ? did : "";
}

function assertJob(value: string): void {
  if (!JOB_ID.test(value)) throw new Error("Kibble job ID must be k plus 10 lowercase hex characters.");
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max) : "";
}
