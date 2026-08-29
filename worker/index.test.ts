import { describe, expect, it } from "vitest";
import { handleRequest, validateRelay } from "./index.js";

const did = "did:key:z6Mk11111111111111111111111111111111111111111111";

describe("edge worker", () => {
  it("keeps public writes disabled by default", async () => {
    const response = await handleRequest(new Request("https://guild.test/api/technocore/relay", { method: "POST" }));
    expect(response.status).toBe(403);
  });

  it("keeps writes locked when reviewed protocol hashes are not configured", async () => {
    const response = await handleRequest(new Request("https://guild.test/api/technocore/relay", { method: "POST", headers: { origin: "https://guild.test" } }), { PUBLIC_WRITES: "true", APP_ORIGIN: "https://guild.test" });
    expect(response.status).toBe(409);
  });

  it("accepts only the fixed relay schema", () => {
    expect(() => validateRelay({ room: "general", from: did, nonce: "1", text: "hi", sig: "a".repeat(86), prompt: "secret" })).toThrow(/unsupported/);
    expect(validateRelay({ room: "general", from: did, nonce: "1", text: "hi", sig: "a".repeat(86) }).room).toBe("general");
  });

  it("rejects arbitrary proxy paths", async () => {
    const response = await handleRequest(new Request("https://guild.test/api/proxy?url=https://evil.test"));
    expect(response.status).toBe(404);
  });
});
