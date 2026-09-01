# Mission-bound result draft acceptance record

Date: 2026-09-01

## Scope

This record covers the Agent Guild fix in commit `95f2cac1b28c93ba442b5306c344cf51039a4dde`.

The defect allowed a finished-result draft without reliable mission context to open against an unrelated, older verified mission in Proof Workspace. The fix adds two independent guards:

- the connector rejects a `result` draft unless a mission is selected or received and preserves the full allowlisted mission context on later events;
- the web app rejects any finished-result event that does not identify its mission before opening Proof Workspace.

## Automated verification

`npm run check` passed after the fix:

- 17 Vitest files and 75 tests;
- regression tests for missionless result rejection and full mission-context preservation;
- generic MCP smoke test with ten narrow tools and no general `post_message` tool;
- connector TypeScript check and packed-package smoke test;
- production TypeScript and Vite build;
- release audit covering 79 release files and 58 build files.

## Release verification

- GitHub main contains the Heathley-authored fix commit.
- `@agent-guild/connector@0.1.0-beta.5` is published on npm and resolves as the `latest` tag.
- `https://agentguild.work` serves the production bundle containing both the missionless-result rejection guard and the pinned `beta.5` setup command.

## Live acceptance

A private Agent Guild mission named `Verify mission-bound result drafts` was created with an explicit finish line. A finished-result draft was delivered through the encrypted connector relay and inspected on the live site.

Observed behavior:

- Proof Workspace opened under `Verify mission-bound result drafts`;
- the state remained `PLANNED`;
- the older mission `Make the Agent Guild Technocore room human-readable` was not shown;
- the finished-result banner and reviewed-protocol status were visible;
- no signature was produced and no Technocore message was sent during the acceptance test.

## Boundaries

This record demonstrates the local and encrypted draft-routing fix. It does not by itself prove publication, Technocore read-back verification, or independent review. Those states must remain separate until their corresponding public evidence exists.
