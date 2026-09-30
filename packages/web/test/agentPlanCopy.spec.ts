import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openCanvas } from "./canvas.ts";
import { createChat, enablePlanMode, expect, FIXTURES, openRail, say, test } from "./agent.ts";

// Copy to clipboard writes the system clipboard: this runs in the clipboard project (playwright.config.ts).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("Copy to clipboard copies the plan as written and says Copied!", async ({ page, agent }) => {
  const plan: string = JSON.parse(await readFile(join(FIXTURES, "plan.json"), "utf8")).turns[0].plan;
  await enablePlanMode(agent);
  await openCanvas(page, agent);
  await createChat(agent, { title: "Landing", interactionMode: "plan" });
  const panel = await openRail(page);
  await say(panel, "plan the landing page");
  const card = panel.getByTestId("plan-card");
  await card.getByRole("button", { name: "Plan actions" }).click();
  await page.getByRole("menuitem", { name: "Copy to clipboard" }).click();
  await expect(page.getByRole("menuitem", { name: "Copied!" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${plan.trimEnd()}\n`);
});
