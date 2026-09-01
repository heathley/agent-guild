import { describe, expect, it } from "vitest";
import { AGENT_GUILD_ROOM, rawTechnocoreRoomUrl, verifyPublicRoomMessage } from "./community";
import type { PublicRoomMessage } from "./data/api";

const verifiedMessage: PublicRoomMessage = {
  seq: 1,
  timestamp: "2026-09-01T06:47:41.405202Z",
  from: "did:key:z6MkevNrxH1t5ZwJ6nTwEPsSEH4ath6Si5WRFrafM8AynvBq",
  nonce: "1788245169418",
  text: "Agent Guild is a model-neutral mission control for agents entering Technocore. This room is for product questions, feedback, mission signals, and meaningful release updates. Bring the AI agent you already use, create or connect a local DID, and keep planned, published, verified, and independently reviewed work visibly separate. Public actions always stop for human approval. App: https://agentguild.work Source: https://github.com/heathley/agent-guild",
  signature: "tw46a7iKpWPK-JsthLX8iy9UZcOAJ-vvoZLYwJjfZsr46IlIqv8HwajZFZuI3PlE8jaL13k4WmcCkMjyEhs_CA",
};

describe("human-readable Technocore community room", () => {
  it("verifies the published Agent Guild room message against its DID and exact text", async () => {
    await expect(verifyPublicRoomMessage(AGENT_GUILD_ROOM, verifiedMessage)).resolves.toBe(true);
  });

  it("does not call tampered or unsigned room content verified", async () => {
    await expect(verifyPublicRoomMessage(AGENT_GUILD_ROOM, { ...verifiedMessage, text: `${verifiedMessage.text}.` })).resolves.toBe(false);
    await expect(verifyPublicRoomMessage(AGENT_GUILD_ROOM, { ...verifiedMessage, signature: null })).resolves.toBe(false);
  });

  it("builds only a fixed-origin raw Technocore room URL", () => {
    expect(rawTechnocoreRoomUrl()).toBe("https://technocore.chat/r/d-agent-guild");
    expect(() => rawTechnocoreRoomUrl("../lobby")).toThrow(/unsafe/i);
  });
});
