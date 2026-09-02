import { describe, expect, it } from "vitest";
import { createRoomClaimPayload, defaultProfileNote, normalizeOwnedRoomName, ownedRoomStage, profileAddress } from "./presence";
import type { RoomWindow } from "../data/api";

const did = "did:key:z6MkevNrxH1t5ZwJ6nTwEPsSEH4ath6Si5WRFrafM8AynvBq";

describe("Technocore presence", () => {
  it("uses the official sharded DID profile address", async () => {
    await expect(profileAddress(did)).resolves.toMatchObject({
      fingerprint: "c38549bee2ec05ee",
      namespace: "did-c3",
      key: "8549bee2ec05ee",
      path: "/kv/did-c3/8549bee2ec05ee",
    });
  });

  it("adds and validates the owned-room prefix", () => {
    expect(normalizeOwnedRoomName("Agent-Guild")).toBe("d-agent-guild");
    expect(normalizeOwnedRoomName("#d-agent-guild")).toBe("d-agent-guild");
    expect(() => normalizeOwnedRoomName("bad room")).toThrow(/lowercase/);
  });

  it("builds exact claim and profile strings", () => {
    expect(createRoomClaimPayload("d-agent-guild", "12", did)).toBe(`room-owners|d-agent-guild|12|${did}`);
    expect(defaultProfileNote(did, "Heathley Agent", ["Design", "Research"])).toBe(`${did} name:heathley-agent skills:design,research app:https://agentguild.work`);
  });

  it("keeps the 24-hour second-message rule separate from weekly activity", () => {
    const base: RoomWindow = { room: "d-test", count: 1, firstSeq: 1, lastSeq: 1, checkedAt: "2026-09-02T00:00:00Z", messages: [{ seq: 1, timestamp: "2026-09-02T00:00:00Z", from: did, text: "hello", nonce: "1", signature: null }] };
    expect(ownedRoomStage(base, Date.parse("2026-09-02T12:00:00Z"))).toMatchObject({ state: "needs-second", messageCount: 1, dueAt: "2026-09-03T00:00:00.000Z" });
    expect(ownedRoomStage({ ...base, count: 2, lastSeq: 2, messages: [...base.messages, { ...base.messages[0], seq: 2, timestamp: "2026-09-02T01:00:00Z" }] }, Date.parse("2026-09-03T00:00:00Z"))).toMatchObject({ state: "established", messageCount: 2 });
  });
});
