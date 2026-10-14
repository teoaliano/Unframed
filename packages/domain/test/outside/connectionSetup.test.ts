import { describe, expect, it } from "vitest";
import { connectionSetup, shellQuote, type ConnectionClient, type SetupInput } from "../../src/index.ts";

const base: SetupInput = {
  client: "claude-code",
  platform: "darwin",
  execPath: "/usr/local/bin/node",
  shimPath: "/repo/packages/engine/src/mcp.ts",
  dataDir: "/Users/me/Library/Application Support/Unframed/data",
  token: "ufx_abc123",
  runAsNode: false,
};

const codeOf = (input: Partial<SetupInput> & { client: ConnectionClient }) =>
  connectionSetup({ ...base, ...input }).steps.map((step) => step.code ?? "");

describe("connection setup: Claude Code", () => {
  it("adds the server at user scope with the token, quoting the data folder with its space", () => {
    const [command] = codeOf({ client: "claude-code" });
    expect(command).toBe(
      "claude mcp add --scope user --env UNFRAMED_MCP_TOKEN=ufx_abc123 unframed-app -- '/usr/local/bin/node' '/repo/packages/engine/src/mcp.ts' --data-dir '/Users/me/Library/Application Support/Unframed/data'",
    );
  });

  it("adds ELECTRON_RUN_AS_NODE only when asked", () => {
    expect(codeOf({ client: "claude-code", runAsNode: true })[0]).toContain("--env UNFRAMED_MCP_TOKEN=ufx_abc123 --env ELECTRON_RUN_AS_NODE=1 unframed-app");
    expect(codeOf({ client: "claude-code", runAsNode: false })[0]).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("says the desktop app's Code tab shares the setup", () => {
    expect(connectionSetup(base).steps[1]!.text).toBe("The Claude desktop app's Code tab uses the same setup.");
  });
});

describe("connection setup: Codex", () => {
  it("gives a command and a config.toml table with the same server name and env", () => {
    const [command, toml] = codeOf({ client: "codex", runAsNode: true });
    expect(command).toBe(
      "codex mcp add unframed-app --env UNFRAMED_MCP_TOKEN=ufx_abc123 --env ELECTRON_RUN_AS_NODE=1 -- '/usr/local/bin/node' '/repo/packages/engine/src/mcp.ts' --data-dir '/Users/me/Library/Application Support/Unframed/data'",
    );
    expect(toml).toBe(
      [
        "[mcp_servers.unframed-app]",
        'command = "/usr/local/bin/node"',
        'args = ["/repo/packages/engine/src/mcp.ts", "--data-dir", "/Users/me/Library/Application Support/Unframed/data"]',
        'env = { UNFRAMED_MCP_TOKEN = "ufx_abc123", ELECTRON_RUN_AS_NODE = "1" }',
      ].join("\n"),
    );
  });

  it("escapes backslashes in Windows paths inside the TOML strings", () => {
    const [, toml] = codeOf({ client: "codex", platform: "win32", execPath: "C:\\Apps\\Unframed.exe", shimPath: "C:\\u\\mcp.js", dataDir: "C:\\data" });
    expect(toml).toContain('command = "C:\\\\Apps\\\\Unframed.exe"');
  });
});

describe("connection setup: Claude app and other clients", () => {
  it("names the macOS config path and restarts the app", () => {
    const steps = connectionSetup({ ...base, client: "claude-desktop" }).steps;
    expect(steps[0]!.text).toBe("Add this to the `mcpServers` object in ~/Library/Application Support/Claude/claude_desktop_config.json:");
    expect(steps[0]!.language).toBe("json");
    expect(steps[0]!.code).toContain('"unframed-app": {');
    expect(steps[0]!.code).toContain('"UNFRAMED_MCP_TOKEN": "ufx_abc123"');
    expect(steps[1]!.text).toBe("Restart the Claude app.");
  });

  it("names the Windows config path under %APPDATA%", () => {
    const steps = connectionSetup({ ...base, client: "claude-desktop", platform: "win32" }).steps;
    expect(steps[0]!.text).toContain("%APPDATA%\\Claude\\claude_desktop_config.json");
  });

  it("gives other clients the same JSON with a generic lead", () => {
    const steps = connectionSetup({ ...base, client: "other" }).steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.text).toBe("Add this stdio server to your MCP client:");
    expect(steps[0]!.code).toContain('"command": "/usr/local/bin/node"');
  });
});

describe("shell quoting", () => {
  it.each([
    ["darwin", "/a b/c", "'/a b/c'"],
    ["darwin", "it's", "'it'\\''s'"],
    ["linux", "/x", "'/x'"],
    ["win32", "C:\\a b", '"C:\\a b"'],
  ])("quotes %s %s as %s", (platform, value, quoted) => {
    expect(shellQuote(value, platform)).toBe(quoted);
  });
});
