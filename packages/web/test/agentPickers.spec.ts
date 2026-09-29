import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { expect, openRail, promptBox, startProvidersEngine } from "./agent.ts";
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
