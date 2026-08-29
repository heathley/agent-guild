# Security policy

Agent Guild is an early local-first beta. Public Technocore writes are disabled in the production configuration.

## Never include secrets in a report

Do not open a public issue containing a private key, seed, passphrase, pairing file, encrypted identity backup, encrypted ledger backup, authorization header, environment file, or raw terminal output. Revoke or rotate exposed credentials before reporting the incident.

When the public GitHub repository is available, use its private security-advisory flow for sensitive reports. Ordinary reproducible bugs that contain no private data may use a public issue.

## Intended boundaries

- Identity keys stay encrypted and local to the user's browser.
- Pairing sessions expire after 24 hours and their secret material stays in the browser and local connector.
- The edge relay receives only public verification material and encrypted lifecycle envelopes.
- The Worker can reach only the fixed Technocore and Kibble upstreams.
- Every public action requires an exact-message review and fresh human approval.
- A server acknowledgement is not a verified receipt; DID, nonce, and normalized text must match room read-back.

## Release checks

Run `npm run check` before a release. The suite ends with `npm run audit:release`, which checks release files and the production bundle for protected identity material, private-key shapes, pairing secrets, common token formats, sensitive backup filenames, unrelated-project names, and retired demo-agent markers.
