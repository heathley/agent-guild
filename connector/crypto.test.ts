import { describe, expect, it } from "vitest";
import { encryptConnectorEvent, pairingSessionId, validatePairingToken } from "./crypto.js";

const token = `agp_${"a".repeat(43)}`;

describe("connector pairing", () => {
  it("accepts only high-entropy shaped pairing tokens", () => {
    expect(validatePairingToken(token)).toBe(token);
    expect(() => validatePairingToken("small")).toThrow(/malformed/);
  });

  it("creates stable opaque session ids and randomized ciphertext", async () => {
    expect(pairingSessionId(token)).toHaveLength(32);
    const first = await encryptConnectorEvent(token, { event: "mission.testing" });
    const second = await encryptConnectorEvent(token, { event: "mission.testing" });
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });
});
