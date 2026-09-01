import { describe, expect, it } from "vitest";
import fixture from "../../artifacts/labs/did-key-rotation/public-fixture.json";
import { verifyDidSignature } from "./vault";
import { createDidRotationStatement, verifyDidRotationProof } from "./rotation";

const effectiveAt = "2026-09-01T13:30:00.000Z";

describe("did:key rotation evidence", () => {
  it("keeps historic signatures verifiable under the old DID", async () => {
    await expect(verifyDidSignature(
      fixture.oldDid,
      fixture.historicMessage,
      fixture.historicSignatureByOld,
    )).resolves.toBe(true);
    await expect(verifyDidSignature(
      fixture.newDid,
      fixture.historicMessage,
      fixture.historicSignatureByOld,
    )).resolves.toBe(false);
  });

  it("requires both identities to sign the same canonical rotation statement", async () => {
    expect(createDidRotationStatement(fixture.oldDid, fixture.newDid, effectiveAt)).toBe(
      fixture.rotationStatement,
    );
    await expect(verifyDidRotationProof({
      oldDid: fixture.oldDid,
      newDid: fixture.newDid,
      effectiveAt,
      oldDidSignature: fixture.rotationSignatureByOld,
      newDidSignature: fixture.rotationSignatureByNew,
    })).resolves.toMatchObject({
      oldDidVerified: true,
      newDidVerified: true,
      continuityVerified: true,
    });
  });

  it("rejects a missing, swapped, or tampered side of the continuity proof", async () => {
    const missingNew = await verifyDidRotationProof({
      oldDid: fixture.oldDid,
      newDid: fixture.newDid,
      effectiveAt,
      oldDidSignature: fixture.rotationSignatureByOld,
      newDidSignature: fixture.rotationSignatureByOld,
    });
    expect(missingNew).toMatchObject({ oldDidVerified: true, newDidVerified: false, continuityVerified: false });

    const tampered = await verifyDidRotationProof({
      oldDid: fixture.oldDid,
      newDid: fixture.newDid,
      effectiveAt: "2026-09-01T13:31:00.000Z",
      oldDidSignature: fixture.rotationSignatureByOld,
      newDidSignature: fixture.rotationSignatureByNew,
    });
    expect(tampered).toMatchObject({ oldDidVerified: false, newDidVerified: false, continuityVerified: false });
  });
});
