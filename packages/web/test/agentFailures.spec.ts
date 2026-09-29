import { FAILURE_SENTENCES } from "@unframed/domain";
import { openCanvas } from "./canvas.ts";
import { createChat, expect, openRail, say, test } from "./agent.ts";

test("a failed turn shows its retry line and ends its reply with the failure sentence, which the error line does not repeat", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { title: "Breaking" });
  const panel = await openRail(page);
  await say(panel, "break it now");
  await expect(panel.getByTestId("retry-line")).toHaveText("The API is busy (529), retrying in 2s. Attempt 1 of 3…");
  await expect(panel.locator("[data-role='assistant']").last()).toContainText(FAILURE_SENTENCES.error_max_turns!);
  await expect(panel.getByRole("button", { name: "Stop generation" })).toHaveCount(0);
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

test("being close to a usage limit shows nothing; a hit limit says so with the time it resets, and clears when a turn goes through", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { title: "Limits" });
  const panel = await openRail(page);
  const time = await page.evaluate(() => new Date("2026-10-01T15:00:00.000Z").toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
  const line = panel.getByTestId("limit-line");

  await say(panel, "near the usage limit");
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Done, but you are close to your usage limit.");
  await expect(line).toHaveCount(0);

  await say(panel, "one more");
  await expect(line).toHaveText(`You have hit a usage limit. It resets at ${time}.`);

  await say(panel, "and again");
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Back under the limit.");
  await expect(line).toHaveCount(0);
});
