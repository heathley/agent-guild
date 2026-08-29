import { describe, expect, it } from "vitest";
import { exportEncryptedLedger, importEncryptedLedger } from "./storage";
import type { LedgerEntry } from "../protocol/models";

const entry: LedgerEntry = {
  id: "local-1", state: "planned", createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
  mission: { id: "m1", source: "local", title: "Test", summary: "Test safely", successCriteria: ["Tests pass"], verification: "Local tests", risk: "low", observedAt: "2026-08-29T00:00:00.000Z" },
};

describe("encrypted ledger backup", () => {
  it("round-trips without exposing entry content", async () => {
    const backup = await exportEncryptedLedger([entry], "correct horse battery staple");
    expect(backup).not.toContain("Test safely");
    await expect(importEncryptedLedger(backup, "correct horse battery staple")).resolves.toEqual([entry]);
  });

  it("rejects the wrong passphrase", async () => {
    const backup = await exportEncryptedLedger([entry], "correct horse battery staple");
    await expect(importEncryptedLedger(backup, "wrong passphrase indeed")).rejects.toThrow(/Incorrect/);
  });
});
