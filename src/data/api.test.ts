import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTechnocoreProtocolStatus, fetchTechnocoreRooms, normalizeRoomWindow, normalizeRooms, protocolStatusIsReady, roomToMission } from "./api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("public source adapters", () => {
  it("retries a failed Technocore room snapshot once", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError("temporary network failure"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rooms: [{ room: "technocore", topic: "Agent work", last_seq: 42 }] }), { status: 200 }));
    vi.stubGlobal("fetch", request);

    const result = fetchTechnocoreRooms();
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual([{ room: "technocore", topic: "Agent work", messages: 42, activeAt: null }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("drops unsafe room names and strips directional controls from topics", () => {
    expect(normalizeRooms({ rooms: [
      { room: "safe-room", topic: "Useful\u202e hidden", last_seq: 7 },
      { room: "../unsafe", topic: "Ignore", last_seq: 8 },
    ] })).toEqual([{ room: "safe-room", topic: "Useful  hidden", messages: 7, activeAt: null }]);
  });

  it("normalizes only the requested latest room window", () => {
    const result = normalizeRoomWindow({
      room: "technocore",
      count: 2,
      first_seq: 10,
      last_seq: 11,
      messages: [
        { seq: 10, ts: "2026-08-29T07:45:05Z", from: "did:key:test", text: "Need\u0000 help", nonce: 1, sig: `${"a".repeat(85)}A` },
        { seq: 11, ts: "invalid", from: "did:key:reviewer", text: "I can review", nonce: "2" },
      ],
    }, "technocore");

    expect(result.firstSeq).toBe(10);
    expect(result.lastSeq).toBe(11);
    expect(result.messages[0]).toMatchObject({ text: "Need  help", nonce: "1", signature: `${"a".repeat(85)}A` });
    expect(result.messages[1].timestamp).toBeNull();
    expect(result.messages[1].signature).toBeNull();
    expect(() => normalizeRoomWindow({ room: "other", messages: [] }, "technocore")).toThrow(/different room/);
  });

  it("records honest latest-window coverage in a planned mission", () => {
    const room = { room: "technocore", topic: "Agent work", messages: 42, activeAt: null };
    const mission = roomToMission(room, "A reproducible test and public commit", {
      room: "technocore", count: 2, firstSeq: 40, lastSeq: 42, checkedAt: "2026-08-29T07:45:05Z", messages: [],
    });

    expect(mission.id).toBe("technocore:technocore:42");
    expect(mission.summary).toContain("sequences 40–42");
    expect(mission.successCriteria).toEqual(["A reproducible test and public commit"]);
  });

  it("requires every reviewed Technocore protocol source before publishing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checkedAt: "2026-09-01T08:15:40Z",
      sources: ["/config", "/openapi.json", "/llms.txt"].map((path) => ({
        path, ok: true, status: 200, sha256: "a".repeat(64), expected: "a".repeat(64), matches: true,
      })),
    }), { status: 200 })));

    const status = await fetchTechnocoreProtocolStatus();
    expect(protocolStatusIsReady(status)).toBe(true);
    status.sources[1].matches = false;
    expect(protocolStatusIsReady(status)).toBe(false);
  });
});
