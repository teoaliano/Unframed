import { describe, expect, it } from "vitest";
import {
  claudeModelRows,
  claudeProbeAuth,
  classifyProvider,
  defaultModel,
  parseCodexLoginStatus,
  parseVersion,
  type CatalogueModel,
} from "../../src/index.ts";

const ok = (output = "2.1.280 (Claude Code)") => ({ kind: "exited" as const, code: 0, output });

describe("provider classification", () => {
  it("reads a missing binary as not installed, for each provider by name", () => {
    expect(classifyProvider("claude", { kind: "not_found" }, undefined)).toEqual({
      status: "not_installed",
      installed: false,
      version: null,
      message: "Claude is not installed or not on PATH.",
    });
    expect(classifyProvider("codex", { kind: "not_found" }, undefined).message).toBe("Codex is not installed or not on PATH.");
  });

  it("reads a timeout, a spawn failure and a non-zero exit as installed but will not run", () => {
    expect(classifyProvider("claude", { kind: "timed_out" }, undefined)).toMatchObject({
      status: "wont_run",
      installed: true,
      message: "Claude is installed but timed out while starting.",
    });
    expect(classifyProvider("codex", { kind: "spawn_failed", code: "EACCES" }, undefined)).toMatchObject({
      status: "wont_run",
      message: "Codex is installed but failed to run (EACCES).",
    });
    expect(classifyProvider("claude", { kind: "exited", code: 1, output: "boom" }, { kind: "signed_in" })).toMatchObject({
      status: "wont_run",
      message: "Claude is installed but failed to run.",
    });
  });

  it("is ready when the probe says signed in, with the account and no message", () => {
    const status = classifyProvider("claude", ok(), { kind: "signed_in", email: "me@example.com", plan: "max" });
    expect(status).toEqual({ status: "ready", installed: true, version: "2.1.280", auth: { email: "me@example.com", plan: "max" } });
  });

  it("is signed out only when the probe says so, naming the login command", () => {
    expect(classifyProvider("claude", ok(), { kind: "signed_out" }).message).toBe(
      "Claude is installed but not signed in. Sign in with `claude login`, then check again.",
    );
    expect(classifyProvider("codex", ok("codex-cli 0.156.1"), { kind: "signed_out" })).toMatchObject({
      status: "signed_out",
      version: "0.156.1",
      message: "Codex is installed but not signed in. Sign in with `codex login`, then check again.",
    });
  });

  it("is auth unknown for anything else the probe says", () => {
    for (const probe of [{ kind: "unknown" as const }, undefined]) {
      expect(classifyProvider("codex", ok(), probe)).toMatchObject({
        status: "auth_unknown",
        installed: true,
        message: "Codex runs, but Unframed could not verify who is signed in.",
      });
    }
  });

  it("finds the first N.N.N with an optional suffix, or none", () => {
    expect(parseVersion("claude 2.1.280 (Claude Code)")).toBe("2.1.280");
    expect(parseVersion("codex-cli 0.157.0-alpha.3\n1.2.3")).toBe("0.157.0-alpha.3");
    expect(parseVersion("version 12")).toBeNull();
  });
});

describe("the Claude probe's account", () => {
  it("is signed out only with no email, subscription, API key source or token source", () => {
    expect(claudeProbeAuth({})).toEqual({ kind: "signed_out" });
    expect(claudeProbeAuth({ apiKeySource: "none" })).toEqual({ kind: "signed_out" });
    expect(claudeProbeAuth({ tokenSource: "claude.ai" })).toEqual({ kind: "signed_in", email: undefined, plan: undefined });
  });

  it("takes the plan from the subscription type, else API key", () => {
    expect(claudeProbeAuth({ email: "me@example.com", subscriptionType: "max" })).toEqual({ kind: "signed_in", email: "me@example.com", plan: "max" });
    expect(claudeProbeAuth({ apiKeySource: "ANTHROPIC_API_KEY" })).toEqual({ kind: "signed_in", email: undefined, plan: "API key" });
  });

  it("never claims signed out for an error or a timeout", () => {
    expect(claudeProbeAuth(undefined)).toEqual({ kind: "unknown" });
  });
});

describe("codex login status", () => {
  it("reads Logged in using <x> as ready with that plan, a leading article dropped", () => {
    expect(parseCodexLoginStatus("Logged in using ChatGPT\n")).toEqual({ kind: "signed_in", plan: "ChatGPT" });
    expect(parseCodexLoginStatus("Logged in using an API key")).toEqual({ kind: "signed_in", plan: "API key" });
    expect(parseCodexLoginStatus("Logged in using a ChatGPT Plus plan")).toEqual({ kind: "signed_in", plan: "ChatGPT Plus plan" });
  });

  it("reads Not logged in as signed out", () => {
    expect(parseCodexLoginStatus("Not logged in\n")).toEqual({ kind: "signed_out" });
  });

  it("reads anything else as unknown", () => {
    expect(parseCodexLoginStatus("")).toEqual({ kind: "unknown" });
    expect(parseCodexLoginStatus("Error: could not read auth.json")).toEqual({ kind: "unknown" });
  });
});

describe("Claude model rows", () => {
  const catalogue: CatalogueModel[] = [
    { id: "claude-opus-5-5", name: "Opus 5.5", aliases: ["opus"], legacy: false },
    { id: "claude-opus-5", name: "Opus 5", aliases: [], legacy: true },
    { id: "claude-sonnet-5", name: "Sonnet 5", aliases: ["sonnet"], legacy: false },
    { id: "claude-haiku-4-5", name: "Haiku 4.5", aliases: ["haiku"], legacy: false },
  ];

  it("puts the SDK's rows first, named from the catalogue by id or alias, with default dropped", () => {
    const rows = claudeModelRows(
      [
        { value: "default", displayName: "Default (recommended)", description: "Opus" },
        { value: "opus", displayName: "Opus", description: "Most capable", supportedEffortLevels: ["low", "high"], supportsFastMode: true },
        { value: "claude-sonnet-5", displayName: "Sonnet", description: "Fast", supportsAdaptiveThinking: true },
      ],
      catalogue,
    );
    expect(rows.slice(0, 2)).toEqual([
      { id: "opus", name: "Opus 5.5", description: "Most capable", efforts: ["low", "high"], legacy: false, fastMode: true },
      { id: "claude-sonnet-5", name: "Sonnet 5", description: "Fast", efforts: ["low", "medium", "high", "xhigh", "max"], legacy: false, thinking: true },
    ]);
  });

  it("names a [1m] row as its model with · 1M", () => {
    const rows = claudeModelRows([{ value: "opus[1m]", displayName: "Opus 1M", description: "" }], catalogue);
    expect(rows[0]).toMatchObject({ id: "opus[1m]", name: "Opus 5.5 · 1M" });
  });

  it("appends every catalogue model the SDK did not report, with the full effort list", () => {
    const rows = claudeModelRows([{ value: "sonnet", displayName: "Sonnet", description: "" }], catalogue);
    expect(rows.map((row) => row.id)).toEqual(["sonnet", "claude-opus-5-5", "claude-opus-5", "claude-haiku-4-5"]);
    expect(rows[2]).toEqual({ id: "claude-opus-5", name: "Opus 5", description: "", efforts: ["low", "medium", "high", "xhigh", "max"], legacy: true });
  });

  it("means the first non-legacy row by an empty model setting", () => {
    expect(defaultModel([{ id: "a", name: "A", description: "", efforts: [], legacy: true }, { id: "b", name: "B", description: "", efforts: [], legacy: false }])).toBe("b");
  });
});
