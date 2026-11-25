import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ONBOARDING_PROTOTYPE_PROMPT } from "@unframed/domain";
import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expect, promptBox, rail, startAgentEngine, startDetectingEngine } from "./agent.ts";
import { roomRecords } from "./canvas.ts";
import { test } from "./fixtures.ts";
import { openSettings, showSection } from "./settings.ts";

const card = (page: Page) => page.getByTestId("onboarding");
const step = (page: Page, id: string) => card(page).locator(`li[data-step='${id}']`);
const onboardingPreference = async (engine: TestEngine): Promise<unknown> => (await (await engine.rpc()).call("preferences.get", { keys: ["onboarding"] })).values.onboarding;

test("a first run checks the agent, names the first project and builds a first prototype with the agent, and Settings brings the checklist back", async ({ page }) => {
  const engine = await startAgentEngine({ preferences: undefined, samplePrompts: false });
  try {
    await page.goto(engine.origin);
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute("data-centered", "");
    await expect(page.getByText("No project is open.")).toHaveCount(0);
    await expect(step(page, "agent")).toHaveAttribute("data-status", "done");
    await expect(step(page, "project")).toHaveAttribute("data-status", "current");
    await expect(card(page).getByTestId("onboarding-progress")).toHaveText("1 of 5 done");

    await card(page).getByRole("textbox", { name: "Project name" }).fill("Coffee shop");
    await card(page).getByRole("button", { name: "Create" }).click();
    await expect(page.locator("[data-canvas-project='coffee-shop'] .tl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(card(page)).not.toHaveAttribute("data-centered", "");
    await expect(step(page, "project")).toHaveAttribute("data-status", "done");
    await expect(step(page, "rail")).toHaveAttribute("data-status", "current");

    await card(page).getByRole("button", { name: "Open the agent", exact: true }).click();
    await expect(rail(page)).toBeVisible();
    await expect(step(page, "rail")).toHaveAttribute("data-status", "done");
    await expect(step(page, "prototype")).toHaveAttribute("data-status", "current");

    await card(page).getByRole("button", { name: "Write the prompt for me" }).click();
    await expect(promptBox(rail(page))).toHaveText(ONBOARDING_PROTOTYPE_PROMPT);
    await rail(page).getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await roomRecords(engine, "coffee-shop")).some((record) => record.typeName === "shape" && record.type === "page"), { timeout: 20_000 }).toBe(true);
    await expect(step(page, "prototype")).toHaveAttribute("data-status", "done");
    await expect(step(page, "generate")).toHaveAttribute("data-status", "current");
    await expect(card(page).getByTestId("onboarding-progress")).toHaveText("4 of 5 done");

    await card(page).getByRole("button", { name: "Hide the checklist" }).click();
    await expect(step(page, "generate")).toHaveCount(0);
    const cardBox = (await card(page).boundingBox())!;
    const headingBox = (await card(page).getByRole("heading", { name: "Get started" }).locator("..").boundingBox())!;
    expect(Math.abs(headingBox.y - cardBox.y - (cardBox.y + cardBox.height - headingBox.y - headingBox.height))).toBeLessThanOrEqual(1);
    await card(page).getByRole("button", { name: "Show the checklist" }).click();

    await card(page).getByRole("button", { name: "Skip the tour" }).click();
    await expect(card(page)).toHaveCount(0);
    expect(await onboardingPreference(engine)).toEqual({ done: true, seen: ["rail", "prototype"] });
    await page.reload();
    await expect(page.locator("[data-canvas-project='coffee-shop'] .tl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(card(page)).toHaveCount(0);

    const dialog = await openSettings(page);
    await showSection(dialog, "General");
    await dialog.getByRole("region", { name: "Getting started" }).getByRole("button", { name: "Show the checklist again" }).click();
    await expect(dialog).toBeHidden();
    await expect(card(page)).toBeVisible();
    await expect(step(page, "agent")).toHaveAttribute("data-status", "done");
    await expect(step(page, "project")).toHaveAttribute("data-status", "done");
    await expect(step(page, "rail")).toHaveAttribute("data-status", "current");
    await expect(step(page, "prototype")).toHaveAttribute("data-status", "done");
    expect(await onboardingPreference(engine)).toEqual({ done: false, seen: ["prototype"] });
  } finally {
    await engine.dispose();
  }
});

test("with no agent installed the first step says how to install one, and skipping the tour opens a default project", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "unframed-onboarding-"));
  const engine = await startDetectingEngine(dir, { preferences: undefined, samplePrompts: false });
  try {
    await page.goto(engine.origin);
    await expect(step(page, "agent")).toHaveAttribute("data-status", "current");
    const providers = card(page).getByTestId("onboarding-providers");
    await expect(providers.locator("li[data-provider='claude']")).toContainText("Claude is not installed or not on PATH.");
    await expect(providers.locator("li[data-provider='claude']").getByRole("link", { name: "How to install" })).toHaveAttribute("href", "https://claude.com/product/claude-code");
    await expect(providers.locator("li[data-provider='codex']")).toContainText("Codex is not installed or not on PATH.");
    await expect(card(page).getByRole("button", { name: "Check again" })).toBeEnabled();
    await expect(card(page).getByTestId("onboarding-progress")).toHaveText("0 of 5 done");

    await step(page, "rail").getByRole("button", { name: /Open the agent panel/ }).click();
    await expect(step(page, "rail")).toContainText("Name your first project to try this.");

    await card(page).getByRole("button", { name: "Skip the tour" }).click();
    await expect(page.locator("[data-canvas-project='default'] .tl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(card(page)).toHaveCount(0);
  } finally {
    await engine.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("someone who used the app before the onboarding existed never sees it", async ({ page }) => {
  const engine = await startAgentEngine({ preferences: undefined, samplePrompts: false });
  try {
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "moodboard" });
    await page.goto(engine.origin);
    await expect(page.locator("[data-canvas-project='moodboard'] .tl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(card(page)).toHaveCount(0);
  } finally {
    await engine.dispose();
  }
});
