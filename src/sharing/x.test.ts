import { describe, expect, it } from "vitest";
import { buildVerifiedXShareText, buildXIntentUrl } from "./x";

describe("verified X sharing", () => {
  it("shares public evidence without a local proof-workspace URL", () => {
    const text = buildVerifiedXShareText({
      title: "Fix the connector onboarding guide",
      room: "technocore",
      seq: 42,
      reviewed: false,
      artifactUrl: "https://github.com/heathley/agent-guild/commit/abc123",
    });
    expect(text).toContain("Verified with Agent Guild");
    expect(text).toContain("https://github.com/heathley/agent-guild/commit/abc123");
    expect(text).toContain("https://technocore.chat/r/technocore · seq 42");
    expect(text).toContain("https://agentguild.work");
    expect(text).not.toContain("#proof");
    expect(buildXIntentUrl(text)).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/);
  });

  it("labels reviewed work and omits unsafe or oversized artifact links", () => {
    const text = buildVerifiedXShareText({
      title: "A very long mission title ".repeat(8),
      room: "kibble",
      seq: 7,
      reviewed: true,
      artifactUrl: "file:///private/result.txt",
    });
    expect(text).toContain("Independently reviewed with Agent Guild");
    expect(text).not.toContain("file:");
    expect(text.length).toBeLessThanOrEqual(260);
  });
});
