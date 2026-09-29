import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { createChat, engineChat, engineChats, expect, FIXTURES, openRail, promptBox, rail, say, test, userTexts } from "./agent.ts";

const PLAN: string = JSON.parse(await readFile(join(FIXTURES, "plan.json"), "utf8")).turns[0].plan;
const TITLE = "Landing page from the three stills";
const IMPLEMENT = `PLEASE IMPLEMENT THIS PLAN:\n${PLAN.trim()}`;

/** A chat in plan mode whose first turn proposed the fixture's plan, open in the rail. */
const planned = async (page: Page, agent: TestEngine): Promise<{ panel: Locator; chatId: string }> => {
  await openCanvas(page, agent);
  const chatId = await createChat(agent, { title: "Landing", interactionMode: "plan" });
  const panel = await openRail(page);
  await say(panel, "plan the landing page");
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Here is the plan.");
  return { panel, chatId };
};

test("a proposed plan shows as a card with its title, a preview that expands, and a download named after it", async ({ page, agent }) => {
  const { panel } = await planned(page, agent);
  const card = panel.getByTestId("plan-card");
  await expect(card.locator(".unframed-agent-plan__badge")).toHaveText("Plan");
  await expect(card.getByRole("heading", { level: 3 })).toHaveText(TITLE);
  await expect(card).not.toContainText("One column on a narrow screen.");
  await card.getByRole("button", { name: "Expand plan" }).click();
  await expect(card).toContainText("One column on a narrow screen.");
  await card.getByRole("button", { name: "Collapse plan" }).click();
  await expect(card).not.toContainText("One column on a narrow screen.");

  await card.getByRole("button", { name: "Plan actions" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download as markdown" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("landing-page-from-the-three-stills.md");
  expect(await readFile(await download.path(), "utf8")).toBe(`${PLAN.trimEnd()}\n`);
});

test("Plan ready offers Implement with an empty draft and Refine once typed; Implement sends the plan in default mode", async ({ page, agent }) => {
  const { panel, chatId } = await planned(page, agent);
  const banner = panel.getByTestId("plan-ready");
  await expect(banner).toHaveText(`Plan ready${TITLE}`);
  await expect(panel.locator("[data-placeholder]")).toHaveAttribute("data-placeholder", "Add feedback to refine the plan, or leave this blank to implement it");
  await expect(panel.getByRole("button", { name: "Implement", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Implementation actions" })).toBeVisible();

  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("shorter please");
  await expect(panel.getByRole("button", { name: "Refine" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Implement", exact: true })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");

  await panel.getByRole("button", { name: "Implement", exact: true }).click();
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Built the landing page from the plan.");
  await expect(banner).toHaveCount(0);
  const chat = await engineChat(agent, chatId);
  expect(chat.interactionMode).toBe("default");
  expect(await userTexts(agent, chatId)).toEqual(["plan the landing page", IMPLEMENT]);
  expect(chat.proposedPlans[0]?.implementedAt).not.toBeNull();
});

test("Implement in a new chat opens a chat titled after the plan and sends the plan there", async ({ page, agent }) => {
  const { panel, chatId } = await planned(page, agent);
  await panel.getByRole("button", { name: "Implementation actions" }).click();
  await page.getByRole("menuitem", { name: "Implement in a new chat" }).click();
  await expect(rail(page).getByRole("tab", { selected: true })).toContainText(`Implement ${TITLE}`);
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Built the landing page from the plan.");
  const fresh = (await engineChats(agent)).find((chat) => chat.id !== chatId)!;
  expect(fresh.title).toBe(`Implement ${TITLE}`);
  expect(await userTexts(agent, fresh.id)).toEqual([IMPLEMENT]);
  expect((await engineChat(agent, fresh.id)).interactionMode).toBe("default");
  expect((await engineChat(agent, chatId)).proposedPlans[0]?.implementationThreadId).toBe(fresh.id);
});

test("Refine sends the draft as feedback and the chat stays in plan mode", async ({ page, agent }) => {
  const { panel, chatId } = await planned(page, agent);
  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("shorter please");
  await panel.getByRole("button", { name: "Refine" }).click();
  await expect.poll(() => userTexts(agent, chatId)).toEqual(["plan the landing page", "shorter please"]);
  expect((await engineChat(agent, chatId)).interactionMode).toBe("plan");
});
