import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { createChat, engineChat, expect, onlyChat, openRail, promptBox, say, sendThrough, startAgentEngine, startProvidersEngine, tabs } from "./agent.ts";
import { test as base } from "./fixtures.ts";

/** An engine whose providers are signed-in fakes, torn down with its folder. */
const test = base.extend<{ providers: TestEngine }>({
  providers: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), "unframed-providers-"));
    const engine = await startProvidersEngine(dir);
    await use(engine);
    await engine.dispose();
    await rm(dir, { recursive: true, force: true });
  },
});

const clear = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
};

const commands = (page: Page) => page.getByRole("listbox", { name: "Commands" });

/** Opens the rail once the providers have been checked and Claude is the draft's provider. */
const railReady = async (page: Page, engine: TestEngine): Promise<Locator> => {
  await openCanvas(page, engine);
  const panel = await openRail(page);
  await expect(panel.getByTestId("model-picker")).toHaveText("Opus 5.5", { timeout: 20_000 });
  return panel;
};

test("/ offers the built-ins, the provider's commands and its skills; each does what it says", async ({ page, providers }) => {
  const panel = await railReady(page, providers);
  const box = promptBox(panel);
  await box.click();

  await box.pressSequentially("/");
  await expect(commands(page).getByRole("option")).toHaveText([
    "/modelSwitch response model for this chat",
    "/planSwitch this chat into plan mode",
    "/defaultSwitch this chat back to normal build mode",
    "/compactSummarise the conversation so far to free up context.",
    "/reviewReview the code",
    "/skill:brandApply the house brandClaude",
  ]);

  // /plan and /default switch the mode, and leave nothing in the box.
  await box.pressSequentially("pla");
  await expect(commands(page).getByRole("option").first()).toHaveText(/^\/plan/);
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId("plan-toggle")).toHaveText("Plan");
  await expect(box).toHaveText("");
  await box.pressSequentially("/default");
  await page.keyboard.press("Tab");
  await expect(panel.getByTestId("plan-toggle")).toHaveText("Build");

  // /model opens the model picker.
  await box.pressSequentially("/model");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Models" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Models" })).toHaveCount(0);

  // A provider command inserts itself.
  await box.click();
  await clear(page);
  await box.pressSequentially("/rev");
  await page.keyboard.press("Enter");
  await expect(box).toHaveText("/review ");

  // /compact is offered only as the whole draft.
  await clear(page);
  await box.pressSequentially("/comp");
  await expect(commands(page).getByRole("option")).toHaveText([/^\/compact/]);
  await clear(page);

  // A skill inserts $<name>, from / or from $.
  await box.pressSequentially("/skill:br");
  await page.keyboard.press("Enter");
  await expect(box.locator("[data-agent-chip='skill']")).toHaveText("$brand");
  await clear(page);
  await box.pressSequentially("$");
  await expect(page.getByRole("listbox", { name: "Skills" }).getByRole("option")).toHaveText(["$brandApply the house brandClaude"]);
  await page.keyboard.press("Enter");
  await expect(box.locator("[data-agent-chip='skill']")).toHaveText("$brand");
  await clear(page);

  // Nothing matches.
  await box.pressSequentially("/zzzz");
  await expect(commands(page).getByText("No matching command.", { exact: true })).toBeVisible();
  await clear(page);
  await box.pressSequentially("$zzzz");
  await expect(page.getByRole("listbox", { name: "Skills" }).getByText("No skills found. Try / to browse provider commands.", { exact: true })).toBeVisible();
});

const models = (page: Page) => page.getByRole("dialog", { name: "Models" });

test("the model picker: provider tabs with logos, search, the Legacy section, and a pick updates the chat", async ({ page, providers }) => {
  const panel = await railReady(page, providers);
  const trigger = panel.getByTestId("model-picker");
  await expect(trigger.locator("[data-logo='claude']")).toHaveCount(1);
  await trigger.click();
  const popup = models(page);
  await expect(popup.getByRole("tab")).toHaveText(["Claude", "Codex"]);
  await expect(popup.getByRole("tab", { name: "Claude" }).locator("[data-logo='claude']")).toHaveCount(1);
  await expect(popup.getByRole("tab", { name: "Codex" }).locator("[data-logo='codex']")).toHaveCount(1);
  const rows = popup.getByRole("listbox").locator(".unframed-agent-model-row__name");
  await expect(rows).toHaveText(["Opus 5.5", "Sonnet 5", "Fable 5.1", "Haiku 4.5"]);
  const legacy = popup.getByRole("button", { name: /Legacy models/ });
  await expect(legacy).toHaveText("Legacy models7 models");
  await expect(legacy).toHaveAttribute("aria-expanded", "false");
  await legacy.click();
  await expect(legacy).toHaveAttribute("aria-expanded", "true");
  await expect(rows).toHaveText(["Opus 5.5", "Sonnet 5", "Fable 5.1", "Haiku 4.5", "Fable 5", "Opus 5", "Opus 4.8", "Opus 4.7", "Opus 4.6", "Opus 4.5", "Sonnet 4.6"]);

  const search = popup.getByRole("textbox", { name: "Search models" });
  await expect(search).toHaveAttribute("placeholder", "Search models...");
  await search.fill("opus 4");
  await expect(rows).toHaveText(["Opus 4.8", "Opus 4.7", "Opus 4.6", "Opus 4.5"]);
  await search.fill("nothing like it");
  await expect(popup.getByText("No models found", { exact: true })).toBeVisible();
  await search.fill("");

  // Arrow keys and Enter pick on the Codex tab; the draft's model follows.
  await popup.getByRole("tab", { name: "Codex" }).click();
  await expect(rows).toHaveText(["GPT-6", "GPT-5.5 Codex"]);
  await search.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  await expect(trigger).toHaveText("GPT-5.5 Codex");
  await expect(trigger.locator("[data-logo='codex']")).toHaveCount(1);

  // On a chat, a pick updates the chat, and the other provider's tab stays shut.
  const chatId = await createChat(providers, { title: "Existing" });
  await expect(tabs(page)).toHaveText(["Existing"]);
  await expect(trigger).toHaveText("Opus 5.5");
  await trigger.click();
  await expect(popup.getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-disabled", "true");
  await popup.getByRole("tab", { name: "Codex" }).hover();
  await expect(page.getByText("A chat stays on the provider it started on. Start a new chat to use Codex.", { exact: true })).toBeVisible();
  await popup.getByRole("option", { name: /Sonnet 5/ }).click();
  await expect(trigger).toHaveText("Sonnet 5");
  await expect.poll(async () => (await engineChat(providers, chatId)).modelSelection).toEqual({ provider: "claude", model: "claude-sonnet-5", traits: {} });
});

test("the model and traits are locked while a turn runs", async ({ page }) => {
  const agent = await startAgentEngine();
  try {
    await openCanvas(page, agent);
    const chatId = await createChat(agent, { runtimeMode: "approval-required" });
    await sendThrough(agent, chatId, "clean the build now");
    const panel = await openRail(page);
    await expect(tabs(page).first().getByTestId("live-dot")).toBeVisible();
    await expect(panel.getByTestId("model-picker")).toBeDisabled();
    await expect(panel.getByTestId("traits-picker")).toHaveCount(0);
  } finally {
    await agent.dispose();
  }
});

test("the traits picker offers only what the model declares, marks the default, names the choice, and a new model drops the rest", async ({ page, providers }) => {
  const panel = await railReady(page, providers);
  const traits = panel.getByTestId("traits-picker");
  await expect(traits).toHaveText("Default");
  await traits.click();
  const popup = page.getByRole("dialog", { name: "Traits" });
  await expect(popup.getByRole("radiogroup")).toHaveCount(3);
  await expect(popup.getByRole("radiogroup", { name: "Reasoning" }).getByRole("radio")).toHaveText([
    "LowFastest; little reasoning",
    "MediumBalanced",
    "HighMore reasoning before acting",
    "Extra highLong reasoning; slower",
    "MaxEverything the model has",
  ]);
  await popup.getByRole("radiogroup", { name: "Reasoning" }).getByRole("radio", { name: /^Max/ }).click();
  await popup.getByRole("radiogroup", { name: "Thinking" }).getByRole("radio", { name: "On" }).click();
  await popup.getByRole("radiogroup", { name: "Fast mode" }).getByRole("radio", { name: "On" }).click();
  await expect(traits).toHaveText("Max · Thinking");
  await expect(traits.getByLabel("Fast mode")).toBeVisible();
  await page.keyboard.press("Escape");

  // Sonnet 5 declares three efforts and neither thinking nor fast mode: every trait it does not declare goes.
  await panel.getByTestId("model-picker").click();
  await page.getByRole("dialog", { name: "Models" }).getByRole("option", { name: /Sonnet 5/ }).click();
  await expect(traits).toHaveText("Default");
  await traits.click();
  await expect(popup.getByRole("radiogroup")).toHaveCount(1);
  await expect(popup.getByRole("radiogroup", { name: "Reasoning" }).getByRole("radio")).toHaveText(["LowFastest; little reasoning", "MediumBalanced", "HighMore reasoning before acting"]);
  await page.keyboard.press("Escape");

  // Codex reports its model's default effort, marked Default and named on the trigger.
  await panel.getByTestId("model-picker").click();
  const models = page.getByRole("dialog", { name: "Models" });
  await models.getByRole("tab", { name: "Codex" }).click();
  await models.getByRole("option", { name: /GPT-6/ }).click();
  await expect(traits).toHaveText("High");
  await traits.click();
  await expect(popup.getByRole("radiogroup", { name: "Reasoning" }).getByRole("radio")).toHaveText(["HighDefault"]);
});

test("the runtime mode picker: four modes with what each does, Full access by default, and a change mid-turn", async ({ page }) => {
  const agent = await startAgentEngine();
  try {
    await openCanvas(page, agent);
    const panel = await openRail(page);
    const mode = panel.getByRole("combobox", { name: "Runtime mode" });
    await expect(mode).toHaveText("Full access");
    await mode.hover();
    await expect(page.getByText("Allow commands and edits without prompts.", { exact: true })).toBeVisible();
    await mode.click();
    const options = page.getByRole("option");
    await expect(options).toHaveText([
      "SupervisedAsk before commands and file changes.",
      "Auto-accept editsAuto-approve edits, ask before other actions.",
      "AutoSupported providers approve routine actions; others still ask.",
      "Full accessAllow commands and edits without prompts.Default",
    ]);
    for (let index = 0; index < 4; index++) await expect(options.nth(index).locator("svg").first()).toBeVisible();
    await options.filter({ hasText: "Supervised" }).click();
    await expect(mode).toHaveText("Supervised");

    // The new chat starts in Supervised, and parks on its approval.
    await say(panel, "clean the build please");
    const chat = await onlyChat(agent, (current) => current.latestTurn?.state === "running");
    expect(chat.runtimeMode).toBe("approval-required");
    await expect(tabs(page).first().getByTestId("live-dot")).toBeVisible();

    // Mid-turn the mode still changes: Cmd+Shift+A from the box opens the picker.
    await promptBox(panel).click();
    await page.keyboard.press("ControlOrMeta+Shift+a");
    await page.getByRole("option").filter({ hasText: "Auto-accept edits" }).click();
    await expect(mode).toHaveText("Auto-accept edits");
    await expect.poll(async () => (await engineChat(agent, chat.id)).runtimeMode).toBe("auto-accept-edits");
    expect((await engineChat(agent, chat.id)).latestTurn?.state).toBe("running");
  } finally {
    await agent.dispose();
  }
});

test("the plan toggle reads Plan or Build with its tooltip, Shift+Tab flips it, and the chat follows", async ({ page }) => {
  const agent = await startAgentEngine();
  try {
    await openCanvas(page, agent);
    const chatId = await createChat(agent, { title: "Planning" });
    const panel = await openRail(page);
    const toggle = panel.getByTestId("plan-toggle");
    await expect(toggle).toHaveText("Build");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.hover();
    await expect(page.getByText("Default mode. Click to enter plan mode.", { exact: true })).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveText("Plan");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await engineChat(agent, chatId)).interactionMode).toBe("plan");
    await page.mouse.move(5, 5);
    await toggle.hover();
    await expect(page.getByText("Plan mode. Click to return to normal build mode.", { exact: true })).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(page.getByText("Plan mode. Click to return to normal build mode.", { exact: true })).toHaveCount(0);

    await promptBox(panel).click();
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toHaveText("Build");
    await expect.poll(async () => (await engineChat(agent, chatId)).interactionMode).toBe("default");
  } finally {
    await agent.dispose();
  }
});

test("the context window meter fills to the scripted usage, turns red above 90 %, and its popover offers Compact context", async ({ page }) => {
  const scripts = await mkdtemp(join(tmpdir(), "unframed-scripts-"));
  await writeFile(
    join(scripts, "usage.json"),
    JSON.stringify({
      when: "how full",
      turns: [
        { text: "Plenty left.", usage: { usedTokens: 50_000, maxTokens: 200_000, totalProcessedTokens: 420_000 } },
        { text: "Nearly full.", usage: { usedTokens: 185_000, maxTokens: 200_000 } },
        { text: "Compacted." },
      ],
    }),
  );
  const agent = await startAgentEngine({ script: scripts });
  try {
    await openCanvas(page, agent);
    const panel = await openRail(page);
    await expect(panel.getByTestId("context-meter")).toHaveCount(0);
    await say(panel, "how full is the context?");
    const meter = panel.getByTestId("context-meter");
    await expect(meter).toHaveAttribute("aria-label", "Context window 25% used");
    await expect(meter).not.toHaveAttribute("data-overloaded");
    await meter.hover();
    const popup = page.getByRole("dialog", { name: "Context Window" });
    await expect(popup.getByText("Context Window", { exact: true })).toBeVisible();
    await expect(popup.getByTestId("context-numbers")).toHaveText("25% · 50k/200k");
    await expect(popup.getByRole("progressbar", { name: "Context window usage" })).toHaveAttribute("aria-valuenow", "25");
    await expect(popup.getByText("Total processed")).toBeVisible();
    await expect(popup.getByText("420k", { exact: true })).toBeVisible();
    await expect(popup.getByText("Context compacts automatically when needed.", { exact: true })).toBeVisible();
    await page.mouse.move(5, 5);

    await say(panel, "and now?");
    await expect(meter).toHaveAttribute("aria-label", "Context window 93% used");
    await expect(meter).toHaveAttribute("data-overloaded", "");
    await meter.hover();
    await popup.getByRole("button", { name: "Compact context" }).click();
    await expect(panel.locator("[data-role='user'] [data-testid='message-text']").last()).toHaveText("/compact");
    await expect(panel.locator("[data-role='assistant']").last()).toContainText("Compacted.");
  } finally {
    await agent.dispose();
    await rm(scripts, { recursive: true, force: true });
  }
});
