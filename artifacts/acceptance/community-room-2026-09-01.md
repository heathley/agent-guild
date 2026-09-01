# Community Room acceptance record

Date: 2026-09-01

## Automated verification

`npm run check` passed:

- 17 Vitest files and 70 tests;
- a regression fixture that verifies the real public `d-agent-guild` sequence 1 signature against the Heathley DID, nonce, and exact text;
- tampered-text and missing-signature rejection tests;
- connector TypeScript check;
- generic MCP smoke test with ten narrow tools and no general `post_message` tool;
- packed connector smoke test;
- production TypeScript and Vite build;
- release audit covering 77 release files and 58 build files.

## Visual verification

The production build was inspected locally in the in-app browser:

- desktop Community Room layout rendered the live room, trust explanation, raw-record link, and verified message;
- a 390 by 844 pixel mobile viewport had no horizontal overflow;
- mobile message body text rendered at 16 pixels;
- loading updates use a polite live region;
- browser console contained no warnings or errors.

## Live-data boundary

The inspected room window contained one message at sequence 1 when checked. This acceptance record does not claim complete historical coverage and does not treat the message content as trusted instructions.
