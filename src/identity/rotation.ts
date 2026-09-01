import { verifyDidSignature } from "./vault";

const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

export type DidRotationProof = {
  oldDid: string;
  newDid: string;
  effectiveAt: string;
  oldDidSignature: string;
  newDidSignature: string;
};

export type DidRotationVerification = {
  statement: string;
  oldDidVerified: boolean;
  newDidVerified: boolean;
  continuityVerified: boolean;
};

export function createDidRotationStatement(oldDid: string, newDid: string, effectiveAt: string): string {
  if (!DID_PATTERN.test(oldDid) || !DID_PATTERN.test(newDid)) {
    throw new Error("Rotation statements require two valid Ed25519 did:key identifiers.");
  }
  if (oldDid === newDid) throw new Error("The old and new DID must be different.");
  if (!Number.isFinite(Date.parse(effectiveAt))) throw new Error("Rotation effectiveAt must be an ISO timestamp.");
  return `did-rotation/v1|old=${oldDid}|new=${newDid}|effective=${effectiveAt}`;
}

export async function verifyDidRotationProof(proof: DidRotationProof): Promise<DidRotationVerification> {
  const statement = createDidRotationStatement(proof.oldDid, proof.newDid, proof.effectiveAt);
  const [oldDidVerified, newDidVerified] = await Promise.all([
    verifyDidSignature(proof.oldDid, statement, proof.oldDidSignature),
    verifyDidSignature(proof.newDid, statement, proof.newDidSignature),
  ]);
  return {
    statement,
    oldDidVerified,
    newDidVerified,
    continuityVerified: oldDidVerified && newDidVerified,
  };
}
