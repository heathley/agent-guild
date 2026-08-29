import { describe, expect, it } from "vitest";
import {
  createEncryptedIdentity,
  exportIdentityBackup,
  parseIdentityBackup,
  signText,
  unlockIdentity,
  verifyText,
  verifyDidSignature,
} from "./vault";

describe("local identity vault", () => {
  it("creates an encrypted Ed25519 did:key and signs verifiable text", async () => {
    const passphrase = "correct horse battery staple";
    const identity = await createEncryptedIdentity("heathley-test", passphrase);
    const serialized = exportIdentityBackup(identity);

    expect(identity.did).toMatch(/^did:key:z6Mk/u);
    expect(serialized).not.toContain(passphrase);
    expect(serialized).not.toContain("privateKey");
    expect(identity.protection.ciphertext.length).toBeGreaterThan(40);

    const privateKey = await unlockIdentity(identity, passphrase);
    const signature = await signText(privateKey, "test contribution proof");

    await expect(verifyText(identity, "test contribution proof", signature)).resolves.toBe(true);
    await expect(verifyDidSignature(identity.did, "test contribution proof", signature)).resolves.toBe(true);
    await expect(verifyText(identity, "changed proof", signature)).resolves.toBe(false);
    expect(parseIdentityBackup(serialized)).toEqual(identity);

    const tampered = JSON.parse(serialized) as { did: string };
    tampered.did = `${tampered.did}x`;
    expect(() => parseIdentityBackup(JSON.stringify(tampered))).toThrow(
      "public DID does not match",
    );
  }, 15_000);

  it("does not unlock with the wrong passphrase", async () => {
    const identity = await createEncryptedIdentity(
      "heathley-test",
      "correct horse battery staple",
    );

    await expect(unlockIdentity(identity, "this is the wrong passphrase")).rejects.toThrow(
      "Incorrect passphrase",
    );
  }, 15_000);
});
