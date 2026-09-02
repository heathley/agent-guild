import { describe, expect, it } from "vitest";
import { encodeFrame, generateHashLock, makeAccept, makeOffer } from "@flop-labs/tclk";
import { parseTclkOffers, replayTclkTranscript, signedTclkFrames, tclkDealToMission } from "./tclk";

const payer = "did:key:z6Mk11111111111111111111111111111111111111111111";
const payee = "did:key:z6Mk22222222222222222222222222222222222222222222";
const base = Date.parse("2026-09-02T10:00:00.000Z");
const offer = makeOffer({
  from: payer, role: "payer", amount: "250", asset: "PAPER-USDC", lock: "hash", rails: ["paper"],
  claimByMs: base + 60_000, refundAfterMs: base + 120_000, expiresMs: base + 30_000, nonce: "aabbccdd",
});
const { hash, preimage } = generateHashLock();
const accept = makeAccept(offer, { from: payee, statement: hash, nonce: "eeff0011" });
const signature = "x".repeat(86);

function message(seq: number, from: string, text: string, timestamp: string, signed = true) {
  return { seq, from, text, timestamp, signature: signed ? signature : null };
}

describe("TCLK Deal Lab adapter", () => {
  it("accepts only official frames bound to their Technocore signing DID", () => {
    const rows = [
      message(1, payer, encodeFrame(offer), "2026-09-02T10:00:01.000Z"),
      message(2, payee, encodeFrame(offer), "2026-09-02T10:00:02.000Z"),
      message(3, payer, encodeFrame(offer), "2026-09-02T10:00:03.000Z", false),
      message(4, payer, "not a frame", "2026-09-02T10:00:04.000Z"),
    ];
    expect(signedTclkFrames(rows)).toHaveLength(1);
  });

  it("pairs a valid acceptance and derives a high-risk paper mission", () => {
    const rows = [
      message(1, payer, encodeFrame(offer), "2026-09-02T10:00:01.000Z"),
      message(2, payee, encodeFrame(accept), "2026-09-02T10:00:02.000Z"),
    ];
    const [deal] = parseTclkOffers(rows, base + 5_000);
    expect(deal.status).toBe("accepted");
    expect(deal.dealRoom).toMatch(/^mb-p-tclk-/);
    expect(tclkDealToMission(deal)).toMatchObject({ source: "tclk-deal", risk: "high", room: deal.dealRoom });
  });

  it("marks an unanswered past offer expired", () => {
    const [deal] = parseTclkOffers([message(1, payer, encodeFrame(offer), "2026-09-02T10:00:01.000Z")], base + 31_000);
    expect(deal.status).toBe("expired");
  });

  it("replays only valid signed deal-room transitions", () => {
    const [deal] = parseTclkOffers([
      message(1, payer, encodeFrame(offer), "2026-09-02T10:00:01.000Z"),
      message(2, payee, encodeFrame(accept), "2026-09-02T10:00:02.000Z"),
    ], base + 5_000);
    const lock = { type: "lock" as const, from: payer, contract: accept.contract, rail: "paper", ref: "paper-ref" };
    const reveal = { type: "reveal" as const, from: payee, contract: accept.contract, secret: preimage };
    const transcript = replayTclkTranscript(deal, [
      message(3, payer, encodeFrame(lock), "2026-09-02T10:00:03.000Z"),
      message(4, payee, encodeFrame(reveal), "2026-09-02T10:00:04.000Z"),
    ], base + 5_000);
    expect(transcript.state.status).toBe("claimed");
    expect(transcript.acceptedFrames).toHaveLength(3);
  });
});
