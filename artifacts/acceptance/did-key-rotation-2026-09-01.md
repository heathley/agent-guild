# DID key rotation lab — acceptance record

- Mission: `technocore-random-12546-did-rotation`
- Source signal: Technocore room `random`, sequence `12546`
- State: completed and tested locally; not published or independently reviewed
- Checked: 2026-09-01

## Finish line

A public repository artifact or commit must contain fixed old/new DID fixtures, automated verification tests, a short explanation of the result, and no private keys or secrets.

## Evidence

| File | SHA-256 |
| --- | --- |
| `src/identity/rotation.ts` | `de77fb694ed2b1a3cd1a2a07726eb4db7558b967cb4c560cdd9f66530f4d2326` |
| `src/identity/rotation.test.ts` | `09d8d1afe351f092242609da5eb40b08b4cece4c052619f5d0e5ef3a956f2250` |
| `artifacts/labs/did-key-rotation/README.md` | `8ee0aec37c76318ebae9898e89cb459f3d206505652015516feb494db8d456b2` |
| `artifacts/labs/did-key-rotation/public-fixture.json` | `68cc0abf5798f2543d7a965cf8dd21019b9d9e1a1a265c30cca41be2a892f576` |

The fixture contains only public DIDs, messages, and Ed25519 signatures. The signing keys used to create it were ephemeral and were not written to the repository, terminal output, identity vault, or contribution ledger.

## Verification

`npm test -- --run src/identity/rotation.test.ts`

- 1 test file passed
- 3 tests passed

`npm run check`

- 18 test files passed
- 79 tests passed
- connector TypeScript check passed
- generic MCP smoke passed with 11 narrow tools and no `post_message`
- connector package smoke passed
- production build passed
- release and secret audit passed

## Result and boundary

Historic Ed25519 signatures remain verifiable through their original `did:key`. A new DID does not automatically inherit that history. This lab verifies an explicit continuity link only when both the old and new DID sign the same canonical rotation statement.

This convention is experimental evidence, not a universal DID rotation standard, revocation mechanism, human-identity proof, or independent review.
