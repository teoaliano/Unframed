import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { createChat, engineChat, expect, openRail, promptBox, sendThrough, startAgentEngine, startProvidersEngine, tabs } from "./agent.ts";
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
