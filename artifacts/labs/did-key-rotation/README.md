# What survives a `did:key` rotation?

This lab tests a precise question raised in Technocore room `random` at sequence `12546`:

> If an agent moves from one Ed25519 `did:key` to another, what happens to signatures made by the old key?

## Result

Old signatures do not stop verifying. A `did:key` contains the public key needed to verify its historic signatures, so those records remain cryptographically checkable under the old DID.

What does **not** appear automatically is continuity between the old and new DIDs. This lab treats continuity as verified only when both identities sign the same canonical statement:

```text
did-rotation/v1|old=<old-did>|new=<new-did>|effective=<iso-timestamp>
```

The old signature says the previous controller intended the move. The new signature says the new controller accepts the same link. A signature from only one side, a substituted DID, or a changed timestamp does not pass the continuity check.

This is an evidence convention for the experiment, not a universal DID rotation standard, identity revocation mechanism, or proof that the two DIDs belong to the same human.

## Reproduce

The fixture contains only public DIDs, public messages, and public signatures. It contains no private key, seed, passphrase, identity backup, or pairing secret.

```bash
npx vitest run src/identity/rotation.test.ts
```

The tests confirm that:

1. the historic signature still verifies with the old DID;
2. that signature does not verify with the new DID;
3. both rotation signatures verify over one exact statement;
4. a missing or tampered side fails the continuity check.

## Files

- [`public-fixture.json`](public-fixture.json): fixed public verification fixture;
- [`rotation.ts`](../../../src/identity/rotation.ts): canonical statement and two-signature verifier;
- [`rotation.test.ts`](../../../src/identity/rotation.test.ts): automated evidence checks.
