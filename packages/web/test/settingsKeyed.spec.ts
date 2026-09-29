import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeClaude, fakeCodex, fakeRuns, fakeShell } from "../../engine/test/agentFakes.ts";
import { makeTempDir } from "../../engine/test/engineProcess.ts";
import { liveKey } from "../../engine/test/oauthStub.ts";
import { gate } from "../../engine/test/openRouterStub.ts";
import { expect, test } from "./fixtures.ts";
import { IMAGE_MODELS, KEY, openApp, openSettings, settingsDialog, startSettingsEngine, TEXT_MODELS, VIDEO_MODELS } from "./settings.ts";

test("with a key: the title, the OpenRouter heading, the spend, cap and remaining line and a 30-hour expiry note", async ({ page }) => {
  const { engine, oauth } = await startSettingsEngine();
  try {
    oauth.keyStatus(() => liveKey({ usage: 7.4412, limit: 10, limit_remaining: 2.5588, expires_at: new Date(Date.now() + 30 * 3600_000 - 60_000).toISOString() }));
    await openApp(page, engine);
    await expect(settingsDialog(page)).toBeHidden();
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "OpenRouter" })).toBeVisible();
    await expect(dialog.getByTestId("key-status")).toHaveText("Connected to OpenRouter. $7.44 spent with this key, of a $10.00 cap, $2.56 still available.");
    await expect(dialog.getByTestId("key-expiry")).toHaveText("This key expires in 30 hours, and nothing renews it. Reconnect before then.");
    await expect(dialog.getByRole("button", { name: "Reconnect OpenRouter" })).toHaveCount(0);
    await expect(dialog.getByLabel("API key")).toBeFocused();
    await expect(dialog.getByLabel("API key")).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "Remove key" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();
    expect(oauth.keyRequests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  } finally {
    await engine.dispose();
  }
});

test("a revoked key says so and offers Reconnect, which hides while a connection is pending", async ({ page }) => {
  const { engine, oauth } = await startSettingsEngine();
  try {
    oauth.keyStatus(() => ({ kind: "status", status: 401, body: { error: { message: "User not found." } } }));
    const held = gate<void>();
    oauth.exchange(async () => {
      await held.promise;
      return { kind: "key", key: "sk-or-v1-reconnected-0000aaaa" };
    });
    await openApp(page, engine);
    const dialog = await openSettings(page);
    await expect(dialog.getByTestId("key-status")).toHaveText("This key no longer works at OpenRouter. It may have been deleted or disabled there.");
    await dialog.getByLabel("Output folder").fill("./typed-but-not-saved");
    await dialog.getByLabel("API key").fill("sk-or-v1-half-typed-key");
    await dialog.getByRole("button", { name: "Reconnect OpenRouter" }).click();
    await expect(dialog.getByTestId("settings-waiting")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reconnect OpenRouter" })).toHaveCount(0);
    // The key field and Save stay usable while a connection is pending.
    await expect(dialog.getByLabel("API key")).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();

    oauth.keyStatus(() => liveKey());
    held.release();
    // A reconnect keeps the dialog and what was typed into the other fields.
    await expect(dialog.getByTestId("settings-waiting")).toHaveCount(0, { timeout: 10_000 });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Output folder")).toHaveValue("./typed-but-not-saved");
    await expect(dialog.getByTestId("key-status")).toHaveText("Connected to OpenRouter. $7.44 spent with this key, of a $10.00 cap, $2.56 still available.");
  } finally {
    await engine.dispose();
  }
});

test("Remove key asks twice, typing cancels the confirm, and the removal says what it did", async ({ page }) => {
  const { engine } = await startSettingsEngine();
  try {
    await openApp(page, engine);
    await writeFile(join(engine.dataDir, "output", "jobs.json"), "{ broken");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Remove key" }).click();
    await expect(dialog.getByRole("button", { name: "Yes, remove it" })).toBeVisible();
    await expect(dialog.getByTestId("key-warning")).toHaveText(
      "This deletes the key from .env. You will need to paste it again, or make a new one at openrouter.ai/keys.",
    );
    await dialog.getByLabel("API key").pressSequentially("s");
    await expect(dialog.getByRole("button", { name: "Remove key" })).toBeVisible();
    await expect(dialog.getByTestId("key-warning")).toHaveCount(0);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${KEY}\n`);

    await dialog.getByRole("button", { name: "Remove key" }).click();
    await dialog.getByRole("button", { name: "Yes, remove it" }).click();
    await expect(dialog.getByTestId("key-warning")).toHaveText("Key removed. Generate is disabled until you add one.");
    await expect(dialog.getByLabel("API key")).toHaveValue("");
    await expect(dialog.getByRole("alert")).toHaveText(/^The key was removed, but renders already in progress could not be stopped: The job store at .+ is not valid JSON: .+/);
    await expect(dialog.getByRole("heading", { name: "Connect OpenRouter to start" })).toBeVisible();
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("");
    expect((await (await engine.rpc()).call("settings.get")).hasKey).toBe(false);
  } finally {
    await engine.dispose();
  }
});

test("the three model selects list their catalogues, and a changed model saves alone", async ({ page }) => {
  const { engine } = await startSettingsEngine();
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);
    const lists: Array<[string, string[], string]> = [
      ["Image", IMAGE_MODELS, "openai/gpt-image-2"],
      ["Text", TEXT_MODELS, "google/gemini-3.5-flash-lite"],
      ["Video", VIDEO_MODELS, "bytedance/seedance-2.0"],
    ];
    for (const [label, models, saved] of lists) {
      const select = dialog.getByRole("combobox", { name: label, exact: true });
      await expect(select).toHaveText(saved);
      await select.click();
      const options = page.getByRole("option");
      await expect(options).toHaveCount(models.length);
      expect((await options.allTextContents()).sort()).toEqual([...models].sort());
      await page.keyboard.press("Escape");
      await expect(options).toHaveCount(0);
    }

    const text = dialog.getByRole("combobox", { name: "Text", exact: true });
    await text.click();
    await page.getByRole("combobox", { name: "Search text models" }).fill("sonnet");
    await expect(page.getByRole("option")).toHaveText(["anthropic/claude-sonnet-5"]);
    await page.getByRole("option", { name: "anthropic/claude-sonnet-5" }).click();
    await expect(text).toHaveText("anthropic/claude-sonnet-5");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("status")).toContainText("Saved to .env");
    await expect(dialog.getByRole("status")).toContainText("Applied right away, no restart needed.");
    await expect(dialog).toBeVisible();
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${KEY}\nOPENROUTER_TEXT_MODEL=anthropic/claude-sonnet-5\n`);

    // Nothing changed: the dialog closes without a call.
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await engine.dispose();
  }
});

test("Browse fills the output folder field with the picked path, and a cancel leaves it", async ({ page }) => {
  const { engine } = await startSettingsEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "/Users/someone/Picked Folder" } });
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);
    const field = dialog.getByLabel("Output folder");
    await expect(field).toHaveValue(join(engine.dataDir, "output"));
    await expect(field).toHaveAttribute("placeholder", "./output");
    await dialog.getByRole("button", { name: "Browse…" }).click();
    await expect(field).toHaveValue("/Users/someone/Picked Folder");
    expect((await (await engine.rpc()).call("settings.get")).outputDir).toBe(join(engine.dataDir, "output"));
  } finally {
    await engine.dispose();
  }
  const cancelled = await startSettingsEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "cancel" } });
  try {
    await openApp(page, cancelled.engine);
    const dialog = await openSettings(page);
    await dialog.getByLabel("Output folder").fill("./typed");
    await dialog.getByRole("button", { name: "Browse…" }).click();
    await expect.poll(async () => (await cancelled.engine.nativeLog()).length).toBe(1);
    await expect(dialog.getByLabel("Output folder")).toHaveValue("./typed");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  } finally {
    await cancelled.engine.dispose();
  }
  const none = await startSettingsEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "none" } });
  try {
    await openApp(page, none.engine);
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Browse…" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("No folder picker available here. Type the path instead.");
  } finally {
    await none.engine.dispose();
  }
});

test("Local agents: a status and dot per provider, Check again refreshes, and a changed command path re-checks", async ({ page }) => {
  const dir = await makeTempDir("unframed-agents-");
  const log = join(dir, "runs.log");
  const shell = await fakeShell(join(dir, "shell"));
  const codex = await fakeCodex(join(dir, "bin"));
  const brokenClaude = await fakeClaude(join(dir, "broken"), { exitCode: 3 });
  const { engine } = await startSettingsEngine({
    dotenv: `OPENROUTER_API_KEY=${KEY}\nCLAUDE_PATH=${join(dir, "missing", "claude")}\nCODEX_PATH=${codex}\n`,
    env: { UNFRAMED_TEST_AGENT_SCRIPT: undefined, SHELL: shell, FAKE_SHELL_PATH: "", FAKE_LOG: log },
  });
  try {
    await openApp(page, engine);
    const dialog = await openSettings(page);
    const agents = dialog.getByRole("region", { name: "Local agents" });
    await expect(agents.getByText("Claude Code or Codex installed and signed in on this Mac lets the agent run on your own plan. Nothing here is sent to OpenRouter.")).toBeVisible();
    const claude = agents.locator("[data-provider='Claude']");
    const codexRow = agents.locator("[data-provider='Codex']");
    await expect(codexRow.getByTestId("provider-status")).toHaveText("ready · 0.156.1 · ChatGPT");
    await expect(codexRow.getByTestId("provider-dot")).toHaveAttribute("data-state", "ready");
    await expect(claude.getByTestId("provider-status")).toHaveText("Claude is not installed or not on PATH.");
    await expect(claude.getByTestId("provider-dot")).toHaveAttribute("data-state", "not_installed");
    await expect(claude.getByRole("link", { name: "How to install" })).toHaveAttribute("href", "https://claude.com/product/claude-code");
    await expect(codexRow.getByRole("link", { name: "How to install" })).toHaveCount(0);
    await expect(dialog.getByLabel("Claude command or path")).toHaveAttribute("placeholder", "claude (found on PATH)");
    await expect(dialog.getByLabel("Codex command or path")).toHaveAttribute("placeholder", "codex (found on PATH)");
    await expect(dialog.getByLabel("Claude config folder (optional)")).toHaveAttribute("placeholder", "Leave empty for the default ~/.claude");

    const versionRuns = async () => (await fakeRuns(log)).filter((run) => run.bin === "codex" && run.args[0] === "--version").length;
    await expect.poll(versionRuns).toBe(1);
    await agents.getByRole("button", { name: "Check again" }).click();
    await expect.poll(versionRuns).toBe(2);
    await expect(codexRow.getByTestId("provider-status")).toHaveText("ready · 0.156.1 · ChatGPT");

    await dialog.getByLabel("Claude command or path").fill(brokenClaude);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("status")).toContainText("Saved to .env");
    await expect(claude.getByTestId("provider-status")).toHaveText("Claude is installed but failed to run.");
    await expect(claude.getByTestId("provider-dot")).toHaveAttribute("data-state", "wont_run");
    await expect(claude.getByRole("link", { name: "How to install" })).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});

test("Follow-up behavior shows Queue by default, saves Steer at once without Save, and keeps it across a restart", async ({ page }) => {
  const dataDir = await makeTempDir();
  const first = await startSettingsEngine({ dataDir });
  try {
    await openApp(page, first.engine);
    const dialog = await openSettings(page);
    const select = dialog.getByRole("combobox", { name: "Follow-up behavior" });
    await expect(select).toHaveText("Queue");
    await select.click();
    await expect(page.getByRole("option", { name: /Queue/ })).toContainText("Wait for the running turn, then send");
    await expect(page.getByRole("option", { name: /Steer/ })).toContainText("Send into the running turn");
    await page.getByRole("option", { name: /Steer/ }).click();
    await expect(select).toHaveText("Steer");
    await expect
      .poll(async () => (await (await first.engine.rpc()).call("preferences.get", { keys: ["agent.followUp"] })).values["agent.followUp"])
      .toBe("steer");
    await first.engine.stop();
  } finally {
    await first.engine.dispose();
  }
  const second = await startSettingsEngine({ dataDir });
  try {
    await openApp(page, second.engine);
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("combobox", { name: "Follow-up behavior" })).toHaveText("Steer");
  } finally {
    await second.engine.dispose();
  }
});
