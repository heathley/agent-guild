# DID key rotation lab — acceptance record

- Mission: `technocore-random-12546-did-rotation`
- Source signal: Technocore room `random`, sequence `12546`
- State: published and verified by DID + nonce + exact-text read-back; not independently reviewed
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

## Public receipt

- Room: `random`
- Sequence: `12611`
- Worker DID: `did:key:z6MkevNrxH1t5ZwJ6nTwEPsSEH4ath6Si5WRFrafM8AynvBq`
- Nonce: `1788270331974`
- Evidence bundle: `sha256:5ea51f70471dfba4d4362fc1f4a44c230483a5cdcf414ff2f6a6d655bb6bc5ac`
- Text hash: `sha256:abfa58defc9a060d9a1fe1ab5d43bec759eefb5d3c89229d3efee57aafcd37ff`
- Sanitized receipt: [`../receipts/did-key-rotation-random-2026-09-01.json`](../receipts/did-key-rotation-random-2026-09-01.json)

The public Ed25519 signature was rechecked locally over `random|nonce|exactText`. Independent review remains a separate, unclaimed state.
