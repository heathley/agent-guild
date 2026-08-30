import { describe, expect, it } from "vitest";
import {
  createSigningPayload,
  createReceipt,
  findPublishedMessage,
  isIndependentReview,
  nextNonce,
  sweepTechnocoreText,
  validateSignedMessage,
} from "./technocore";

const worker = "did:key:z6MkqFJgWkWQaYb1xjEoR7vXvUZz9nR3wUq3nM6pZQqYJ8oP";
const reviewer = "did:key:z6MktS4tsCkL7a1YkT9Q9QWbZsS4x2J8D6K7hR4J9TgMxPpZ";

describe("Technocore protocol", () => {
  it("implements the documented single-line sweep without NFC normalization", () => {
    expect(sweepTechnocoreText("  hello\nworld\u200B!  ")).toBe("hello world !");
    expect(sweepTechnocoreText("e\u0301")).toBe("e\u0301");
  });

  it("creates the exact room nonce and swept-text payload", () => {
    expect(createSigningPayload("general", "42", " hi\nthere ")).toBe("general|42|hi there");
  });

  it("keeps the nonce monotonic", () => {
    expect(nextNonce("100", 50)).toBe("101");
    expect(nextNonce("100", 150)).toBe("150");
  });

  it("accepts only a narrow relay envelope", () => {
    expect(() =>
      validateSignedMessage({ room: "General", from: worker, text: "hi", nonce: "1", sig: "x".repeat(86) }),
    ).toThrow(/Room names/);
    expect(() =>
      validateSignedMessage({ room: "general", from: worker, text: "hi\n", nonce: "1", sig: "x".repeat(86) }),
    ).toThrow(/already match/);
  });

  it("matches read-back by DID nonce and exact normalized text", () => {
    const message = { seq: 7, ts: "2026-08-29T00:00:00Z", from: worker, nonce: "11", text: "done" };
    expect(findPublishedMessage([message], { from: worker, nonce: "11", text: "done" })).toEqual(message);
    expect(findPublishedMessage([message], { from: worker, nonce: "12", text: "done" })).toBeNull();
  });

  it("requires a different DID and the same result hash for review", () => {
    expect(isIndependentReview(worker, reviewer, "abc", "abc")).toBe(true);
    expect(isIndependentReview(worker, worker, "abc", "abc")).toBe(false);
    expect(isIndependentReview(worker, reviewer, "abc", "xyz")).toBe(false);
  });

  it("creates a receipt only when the public text contains the exact result digest", async () => {
    const digest = "sha256:1234567890abcdef";
    const message = { seq: 7, ts: "2026-08-29T00:00:00Z", from: worker, nonce: "11", text: `Built and tested. Result digest: ${digest}` };
    await expect(createReceipt("general", message, "x".repeat(86), digest)).resolves.toMatchObject({ resultHash: digest });
    await expect(createReceipt("general", { ...message, text: "Built and tested." }, "x".repeat(86), digest)).rejects.toThrow(/exact evidence digest/);
  });
});
