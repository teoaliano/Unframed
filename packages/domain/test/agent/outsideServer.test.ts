import { describe, expect, it } from "vitest";
import { inAppClaudeDisallowedTools, inAppCodexOutsideOffArgs } from "../../src/index.ts";

describe("in-app sessions skip the outside server", () => {
  it("denies every tool of the outside server to Claude, whatever the runtime mode", () => {
    expect(inAppClaudeDisallowedTools()).toEqual(["mcp__unframed-app"]);
  });

  it("switches the outside server off in the Codex launch arguments", () => {
    expect(inAppCodexOutsideOffArgs()).toEqual(["-c", "mcp_servers.unframed-app.enabled=false"]);
  });
});
