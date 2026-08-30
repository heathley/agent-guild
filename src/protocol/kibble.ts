import type { Mission } from "./models";

export type KibbleBoardItem = {
  job_id?: unknown;
  title?: unknown;
  body?: unknown;
  poster_did?: unknown;
  worker_did?: unknown;
  result_hash?: unknown;
  status?: unknown;
  created_at?: unknown;
};

export type KibbleBoardSnapshot = {
  missions: Mission[];
  total: number;
  open: number;
  claimed: number;
  attested: number;
  rejected: number;
  other: number;
  provisional: number;
  degraded: boolean;
  error: string;
};

const TEXT_LIMIT = 2_000;

export function normalizeKibbleBoard(input: unknown): Mission[] {
  const rows = extractRows(input);
  return rows.flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const item = row as KibbleBoardItem;
    const id = safeText(item.job_id, 96) || `community-${index}`;
    const title = safeText(item.title, 160) || "Untitled community request";
    const body = safeText(item.body, TEXT_LIMIT);
    const status = safeText(item.status, 32).toLowerCase();
    if (!body || (status && !["open", "job", "available"].includes(status))) return [];

    return [{
      id: `kibble:${id}`,
      source: "kibble-community",
      room: "kibble",
      title,
      summary: body,
      authorDid: safeText(item.poster_did, 180) || undefined,
      successCriteria: ["Confirm the request with its author before execution", "Publish an artifact and result hash"],
      verification: "Kibble RESULT must match the public room result_hash; a different DID must ATTEST.",
      risk: /token|seed|private key|password|download|execute|curl|wallet/i.test(body) ? "high" : "medium",
      observedAt: safeDate(item.created_at),
      resultHash: safeText(item.result_hash, 160) || undefined,
      claimable: true,
      sourceState: "verified-open",
    } satisfies Mission];
  });
}

export function normalizeKibbleBoardSnapshot(input: unknown): KibbleBoardSnapshot {
  const rows = extractRows(input).filter((row): row is KibbleBoardItem => Boolean(row && typeof row === "object"));
  const fallbackRows = extractFallbackRows(input);
  const counts = { open: 0, claimed: 0, attested: 0, rejected: 0, other: 0 };
  for (const row of rows) {
    const status = safeText(row.status, 32).toLowerCase();
    if (["open", "job", "available"].includes(status)) counts.open += 1;
    else if (status === "claimed") counts.claimed += 1;
    else if (status === "attested") counts.attested += 1;
    else if (status === "rejected") counts.rejected += 1;
    else counts.other += 1;
  }
  return {
    missions: [...normalizeKibbleBoard(input), ...normalizeFallbackMissions(fallbackRows)],
    total: rows.length + fallbackRows.length,
    ...counts,
    provisional: fallbackRows.length,
    degraded: Boolean(input && typeof input === "object" && (input as Record<string, unknown>).degraded === true),
    error: input && typeof input === "object" ? safeText((input as Record<string, unknown>).error, 300) : "",
  };
}

function normalizeFallbackMissions(rows: unknown[]): Mission[] {
  return rows.flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = safeText(item.id ?? item.job_id, 96) || `room-signal-${index}`;
    const title = safeText(item.title, 160);
    const body = safeText(item.summary ?? item.body, TEXT_LIMIT);
    if (!/^k[0-9a-f]{10}$/.test(id) || !title || !body) return [];
    return [{
      id: `kibble:${id}`, source: "kibble-community", title, summary: body,
      room: "kibble",
      authorDid: safeText(item.authorDid ?? item.poster_did, 180) || undefined,
      successCriteria: ["Wait for Kibble board verification before claiming", "Publish an artifact and result hash"],
      verification: "Room-derived signal only. The Kibble board must confirm the job is open before CLAIM.",
      risk: item.risk === "high" ? "high" : "medium", observedAt: safeDate(item.observedAt ?? item.created_at),
      claimable: false, sourceState: "room-unverified",
    } satisfies Mission];
  });
}

function extractRows(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];
  const value = input as Record<string, unknown>;
  for (const key of ["jobs", "board", "items", "data"]) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  return [];
}

function extractFallbackRows(input: unknown): unknown[] {
  if (!input || typeof input !== "object") return [];
  const value = input as Record<string, unknown>;
  return Array.isArray(value.fallback_jobs) ? value.fallback_jobs : [];
}

function safeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, limit);
}

function safeDate(value: unknown): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date(0).toISOString();
}
