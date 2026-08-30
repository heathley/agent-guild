import { describe, expect, it } from "vitest";
import { claimIsBoardVerified, createKibbleAttest, createKibbleClaim, createKibbleResult, findKibbleJob, kibbleJobId, resultIsBoardVerified } from "./kibble-actions";

const worker = "did:key:z6Mk11111111111111111111111111111111111111111111";

describe("Kibble action state machine", () => {
  it("builds exact CLAIM, RESULT and hash-bound ATTEST messages", () => {
    expect(kibbleJobId("kibble:k0123456789")).toBe("k0123456789");
    expect(createKibbleClaim("k0123456789")).toBe("CLAIM v1 | k0123456789 | worker");
    expect(createKibbleResult("k0123456789", "tested artifact")).toBe("RESULT v1 | k0123456789 | tested artifact");
    expect(createKibbleAttest("k0123456789", "abc123", true, "Reproduced the documented check")).toContain("rh:abc123");
  });

  it("requires the board to bind CLAIM and RESULT to the same worker", () => {
    const job = findKibbleJob({ jobs: [{ job_id: "k0123456789", status: "delivered", worker_did: worker, result_hash: "abc123" }] }, "k0123456789");
    expect(claimIsBoardVerified(job, worker)).toBe(true);
    expect(resultIsBoardVerified(job, worker)).toBe(true);
    expect(resultIsBoardVerified(job, "did:key:z6Mk22222222222222222222222222222222222222222222")).toBe(false);
  });

  it("rejects malformed IDs and thin ATTEST data", () => {
    expect(() => createKibbleClaim("bad")).toThrow(/job ID/);
    expect(() => createKibbleAttest("k0123456789", "", true, "ok")).toThrow(/result hash/);
  });
});
