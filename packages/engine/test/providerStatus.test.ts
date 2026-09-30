import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeClaude, fakeCodex, fakeRuns, fakeShell } from "./agentFakes.ts";
import { makeTempDir, startEngine } from "./harness.ts";

/** An engine whose login shell is a fake that adds `shellPath` to PATH, with every fake run logged. */
const detecting = async (options: { dotenv?: string; env?: Record<string, string>; shellPath?: string } = {}) => {
  const dir = await makeTempDir("unframed-providers-");
  const log = join(dir, "runs.log");
  const shell = await fakeShell(join(dir, "shell"));
  const engine = await startEngine({
    ...(options.dotenv === undefined ? {} : { dotenv: options.dotenv }),
    env: { SHELL: shell, FAKE_SHELL_PATH: options.shellPath ?? "", FAKE_LOG: log, ...options.env },
  });
  return { engine, rpc: await engine.rpc(), dir, runs: () => fakeRuns(log) };
};

describe("providers.getStatuses", () => {
  it("reports each provider not installed when its binary is not there", async () => {
    const dir = await makeTempDir();
    const { rpc } = await detecting({ dotenv: `CLAUDE_PATH=${join(dir, "missing", "claude")}\nCODEX_PATH=${join(dir, "missing", "codex")}\n` });
    const statuses = await rpc.call("providers.getStatuses", {});
    expect(statuses.claude).toMatchObject({
      kind: "claude",
      name: "Claude",
      status: "not_installed",
      installed: false,
      version: null,
      message: "Claude is not installed or not on PATH.",
      install: "https://claude.com/product/claude-code",
    });
    expect(statuses.codex).toMatchObject({
      status: "not_installed",
      message: "Codex is not installed or not on PATH.",
      install: "https://developers.openai.com/codex/cli",
    });
    expect(Date.parse(statuses.claude.checkedAt)).not.toBeNaN();
  });

  it("reports a binary that exits non-zero as installed but will not run", async () => {
    const dir = await makeTempDir();
    const claude = await fakeClaude(join(dir, "bin"), { exitCode: 3 });
    const { rpc } = await detecting({ dotenv: `CLAUDE_PATH=${claude}\nCODEX_PATH=${join(dir, "none")}\n` });
    expect((await rpc.call("providers.getStatuses", {})).claude).toMatchObject({
      status: "wont_run",
      installed: true,
      version: "2.1.280",
      message: "Claude is installed but failed to run.",
    });
  });

  it.each([
    ["Logged in using ChatGPT", { status: "ready", auth: { plan: "ChatGPT" } }],
    ["Not logged in", { status: "signed_out", message: "Codex is installed but not signed in. Sign in with `codex login`, then check again." }],
    ["Error: could not read auth.json", { status: "auth_unknown", message: "Codex runs, but Unframed could not verify who is signed in." }],
  ])("reads codex login status %j", async (login, expected) => {
    const dir = await makeTempDir();
    const codex = await fakeCodex(join(dir, "bin"));
    const { rpc } = await detecting({ dotenv: `CODEX_PATH=${codex}\nCLAUDE_PATH=${join(dir, "none")}\n`, env: { FAKE_CODEX_LOGIN: login } });
    const statuses = await rpc.call("providers.getStatuses", {});
    expect(statuses.codex).toMatchObject({ kind: "codex", installed: true, version: "0.156.1", ...expected });
    expect(JSON.stringify(statuses)).not.toContain(dir);
  });

  it("lists a ready Codex's models from its app-server, every page, the default first", async () => {
    const dir = await makeTempDir();
    const codex = await fakeCodex(join(dir, "bin"));
    const { rpc } = await detecting({ dotenv: `CODEX_PATH=${codex}\nCLAUDE_PATH=${join(dir, "none")}\n` });
    const { codex: status } = await rpc.call("providers.getStatuses", {});
    expect(status.models).toEqual([
      { id: "gpt-6", name: "GPT-6", description: "Newest", efforts: ["high"], legacy: false, defaultEffort: "high" },
      { id: "gpt-5.5-codex", name: "GPT-5.5 Codex", description: "", efforts: ["low", "medium"], legacy: false, defaultEffort: "medium" },
    ]);
    expect(status.commands?.map((command) => command.name)).toEqual(["compact", "feedback"]);
  });

  it("finds a CLI on the login shell's PATH, as a Dock launch must", async () => {
    const dir = await makeTempDir();
    await fakeCodex(join(dir, "shell-bin"));
    const { rpc } = await detecting({ shellPath: join(dir, "shell-bin"), dotenv: `CLAUDE_PATH=${join(dir, "none")}\n` });
    expect((await rpc.call("providers.getStatuses", {})).codex.status).toBe("ready");
  });
});

describe("the status cache", () => {
  it("answers from the cache for five minutes, re-checks on refresh, and forgets on saving CODEX_PATH", async () => {
    const dir = await makeTempDir();
    const codex = await fakeCodex(join(dir, "bin"));
    const other = await fakeCodex(join(dir, "other"));
    const { rpc, runs } = await detecting({ dotenv: `CODEX_PATH=${codex}\nCLAUDE_PATH=${join(dir, "none")}\n` });
    const versionRuns = async () => (await runs()).filter((run) => run.args[0] === "--version").length;

    await rpc.call("providers.getStatuses", {});
    expect(await versionRuns()).toBe(1);
    await rpc.call("providers.getStatuses", {});
    expect(await versionRuns()).toBe(1);

    await rpc.call("providers.getStatuses", { refresh: true });
    expect(await versionRuns()).toBe(2);

    await rpc.call("settings.update", { codexPath: other });
    await rpc.call("providers.getStatuses", {});
    expect(await versionRuns()).toBe(3);
  });
});

describe("the scripted agent", () => {
  it("reports both providers ready with the scripted account and one model, with no CLI installed", async () => {
    const dir = await makeTempDir();
    const { rpc, runs } = await detecting({
      dotenv: `CLAUDE_PATH=${join(dir, "none")}\nCODEX_PATH=${join(dir, "none")}\n`,
      env: { UNFRAMED_TEST_AGENT_SCRIPT: join(import.meta.dirname, "../../../assets/fixtures") },
    });
    const statuses = await rpc.call("providers.getStatuses", { refresh: true });
    for (const status of [statuses.claude, statuses.codex]) {
      expect(status).toMatchObject({
        status: "ready",
        auth: { email: "scripted@unframed.test", plan: "Script" },
        models: [{ id: "scripted", name: "Scripted" }],
      });
    }
    expect(await runs()).toEqual([]);
  });
});
