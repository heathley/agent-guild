import {
  OFFER_ROOM,
  applyFrame,
  dealRoom,
  openContract,
  tryDecodeFrame,
  type AcceptFrame,
  type ContractState,
  type OfferFrame,
  type TclkFrame,
} from "@flop-labs/tclk";
import type { Mission } from "./models";

export { OFFER_ROOM };

export type TclkPublicMessage = {
  seq: number;
  timestamp: string | null;
  from: string;
  text: string;
  signature: string | null;
};

export type TclkFrameRecord = {
  frame: TclkFrame;
  seq: number;
  timestamp: string | null;
  signerDid: string;
};

export type TclkDealCard = {
  offer: OfferFrame;
  offerRecord: TclkFrameRecord;
  accept: AcceptFrame | null;
  acceptRecord: TclkFrameRecord | null;
  status: "open" | "accepted" | "expired";
  dealRoom: string | null;
};

export type TclkTranscript = {
  state: ContractState;
  acceptedFrames: TclkFrameRecord[];
  rejectedFrames: number;
};

/**
 * Read a mixed, user-written room fail-closed. A frame counts only when the
 * official TCLK decoder accepts it, the Technocore record is signed, and the
 * frame's declared `from` matches the signing DID beside the room message.
 */
export function signedTclkFrames(messages: readonly TclkPublicMessage[]): TclkFrameRecord[] {
  return messages.flatMap((message) => {
    if (!message.signature) return [];
    const frame = tryDecodeFrame(message.text);
    if (!frame || frame.from !== message.from) return [];
    return [{ frame, seq: message.seq, timestamp: safeTimestamp(message.timestamp), signerDid: message.from }];
  });
}

export function parseTclkOffers(messages: readonly TclkPublicMessage[], nowMs = Date.now()): TclkDealCard[] {
  const records = signedTclkFrames(messages).sort((a, b) => a.seq - b.seq);
  const offers = records.filter((record): record is TclkFrameRecord & { frame: OfferFrame } => record.frame.type === "offer");
  const accepts = records.filter((record): record is TclkFrameRecord & { frame: AcceptFrame } => record.frame.type === "accept");

  return offers.map((offerRecord) => {
    let state = openContract(offerRecord.frame);
    let accepted: (TclkFrameRecord & { frame: AcceptFrame }) | null = null;
    for (const candidate of accepts) {
      if (candidate.frame.ref !== offerRecord.frame.id) continue;
      const applied = applyFrame(state, candidate.frame, eventTime(candidate, nowMs));
      if (!applied.ok) continue;
      state = applied.state;
      accepted = candidate;
      break;
    }
    const expired = !accepted && nowMs >= offerRecord.frame.expiresMs;
    const status: TclkDealCard["status"] = accepted ? "accepted" : expired ? "expired" : "open";
    return {
      offer: offerRecord.frame,
      offerRecord,
      accept: accepted?.frame || null,
      acceptRecord: accepted || null,
      status,
      dealRoom: accepted ? dealRoom(accepted.frame.contract) : null,
    };
  }).sort((a, b) => b.offerRecord.seq - a.offerRecord.seq);
}

export function replayTclkTranscript(deal: TclkDealCard, messages: readonly TclkPublicMessage[], nowMs = Date.now()): TclkTranscript {
  let state = openContract(deal.offer);
  const acceptedFrames: TclkFrameRecord[] = [];
  let rejectedFrames = 0;

  if (deal.acceptRecord) {
    const result = applyFrame(state, deal.acceptRecord.frame, eventTime(deal.acceptRecord, nowMs));
    if (result.ok) {
      state = result.state;
      acceptedFrames.push(deal.acceptRecord);
    } else {
      rejectedFrames += 1;
    }
  }

  for (const record of signedTclkFrames(messages).sort((a, b) => a.seq - b.seq)) {
    if (record.frame.type === "offer" || record.frame.type === "accept") continue;
    const contract = "contract" in record.frame ? record.frame.contract : "";
    if (!deal.accept || contract !== deal.accept.contract) continue;
    const result = applyFrame(state, record.frame, eventTime(record, nowMs));
    if (!result.ok) {
      rejectedFrames += 1;
      continue;
    }
    state = result.state;
    acceptedFrames.push(record);
  }

  return { state, acceptedFrames, rejectedFrames };
}

export function tclkDealToMission(deal: TclkDealCard): Mission {
  const counterparty = deal.offer.role === "payer" ? "a payee" : "a payer";
  const job = deal.offer.job ? ` External job: ${deal.offer.job.proto}/${deal.offer.job.id}.` : "";
  return {
    id: `tclk:${deal.offer.id}`,
    source: "tclk-deal",
    title: `Evaluate ${deal.offer.amount} ${deal.offer.asset} paper deal`,
    summary: `Review a signed tclk/1 ${deal.offer.role} offer seeking ${counterparty}.${job} The shipped PaperRail records lifecycle events but locks no funds.`,
    room: deal.dealRoom || OFFER_ROOM,
    authorDid: deal.offer.from,
    successCriteria: [
      "Confirm the offer terms, deadlines, settlement rail, and counterparty before any public frame",
      "Use the official TCLK tools for protocol frames; never place a secret, preimage, payment key, or signing key in Agent Guild",
      "Return any proposed public frame as an exact-text approval request instead of posting it automatically",
    ],
    verification: "Every signed TCLK frame must be read back from its expected Technocore room. PaperRail proves a transcript lifecycle only; it does not prove payment or work quality.",
    risk: "high",
    observedAt: deal.offerRecord.timestamp || new Date(0).toISOString(),
    sourceSeq: deal.offerRecord.seq,
  };
}

function eventTime(record: TclkFrameRecord, fallback: number): number {
  const value = record.timestamp ? Date.parse(record.timestamp) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

function safeTimestamp(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
