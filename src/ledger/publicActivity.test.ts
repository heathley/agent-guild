import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicActivityRecord } from "../protocol/models";
import { loadPublicActivity, savePublicActivity, splitPublicActivity } from "./publicActivity";

const did = "did:key:z6MkevNrxH1t5ZwJ6nTwEPsSEH4ath6Si5WRFrafM8AynvBq";
const verified: PublicActivityRecord = {
  id: "activity-verified",
  kind: "progress",
  room: "technocore",
  exactText: "A bounded transport check.",
  state: "verified",
  createdAt: "2026-08-31T12:10:00.000Z",
  receipt: {
    room: "technocore",
    seq: 42,
    serverTimestamp: "2026-08-31T12:10:01.000Z",
    did,
    nonce: "1788178324312",
    normalizedText: "A bounded transport check.",
    textSha256: "a".repeat(64),
    signature: "A".repeat(85) + "Q",
    verifiedAt: "2026-08-31T12:10:02.000Z",
  },
};

describe("public activity ledger", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
  });

  afterEach(() => {
    values.clear();
    vi.unstubAllGlobals();
  });

  it("preserves a sanitized verified receipt", () => {
    savePublicActivity([verified]);
    expect(loadPublicActivity()).toEqual([verified]);
  });

  it("drops verified records with missing or mismatched receipts", () => {
    localStorage.setItem("agent-guild:public-activity", JSON.stringify([
      { ...verified, receipt: undefined },
      { ...verified, id: "wrong-room", receipt: { ...verified.receipt!, room: "other" } },
      { ...verified, id: "wrong-hash", receipt: { ...verified.receipt!, textSha256: "unsafe" } },
    ]));
    expect(loadPublicActivity()).toEqual([]);
  });

  it("keeps stopped prepared attempts out of the visible activity feed", () => {
    const prepared: PublicActivityRecord = { ...verified, id: "prepared", state: "prepared", receipt: undefined };
    expect(splitPublicActivity([prepared, verified])).toEqual({ visible: [verified], prepared: [prepared] });
  });
});
