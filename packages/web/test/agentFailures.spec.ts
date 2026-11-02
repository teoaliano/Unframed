import { FAILURE_SENTENCES, resetMoment } from "@unframed/domain";
import { openCanvas } from "./canvas.ts";
import { createChat, engineChat, expect, openRail, promptBox, say, test } from "./agent.ts";

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

test("a turn that was stopped offers Resume thread in place of Send while the box is empty, which carries the chat on", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const chatId = await createChat(agent, { title: "Long job" });
  const panel = await openRail(page);
  await say(panel, "start the long job");
  await expect(panel.getByTestId("question-panel")).toBeVisible();
  await panel.getByRole("button", { name: "Stop generation" }).click();
  const resume = panel.getByRole("button", { name: "Resume thread" });
  await expect(resume).toBeVisible();
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);

  // Anything in the box is a message of its own, so Send comes back.
  await promptBox(panel).click();
  await promptBox(panel).pressSequentially("x");
  await expect(resume).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await promptBox(panel).press("Backspace");
  await expect(resume).toBeVisible();

  await resume.click();
  await expect(panel.locator("[data-role='assistant']").last()).toContainText("Picked up where I stopped.");
  await expect(resume).toHaveCount(0);
  const chat = await engineChat(agent, chatId);
  expect(chat.messages.filter((message) => message.role === "user").map((message) => message.text)).toEqual(["start the long job", "Continue where you left off."]);
});

test.describe(() => {
  test.use({ locale: "en-GB" });

  test("being close to a usage limit shows nothing; a hit limit says when it resets, in the transcript and in t3code's banner, with the weekday and am or pm in a 24-hour locale, and clears when a turn goes through", async ({ page, agent }) => {
    // Three days before the scripted reset (Thursday 1 October, 15:00 UTC): the line names the day.
    const now = new Date("2026-09-28T12:00:00.000Z");
    await page.clock.setFixedTime(now);
    await openCanvas(page, agent);
    await createChat(agent, { title: "Limits" });
    const panel = await openRail(page);
    // The browser and this process share the machine's time zone.
    const when = resetMoment(new Date("2026-10-01T15:00:00.000Z"), now);
    expect(when).toMatch(/^Thursday at \d{1,2}:\d{2} (am|pm)$/);
    const line = panel.getByTestId("limit-line");

    await say(panel, "near the usage limit");
    await expect(panel.locator("[data-role='assistant']").last()).toContainText("Done, but you are close to your usage limit.");
    await expect(line).toHaveCount(0);

    const banner = panel.locator("[data-notice='usage-limit']");
    await expect(banner).toHaveCount(0);
    await say(panel, "one more");
    await expect(line).toHaveText(`You have hit a usage limit. It resets ${when}.`);
    // t3code's banner above the composer, and its Resume thread in place of Send.
    await expect(banner.getByTestId("notice-title")).toHaveText("Usage limit reached");
    await expect(banner.getByTestId("notice-description")).toHaveText(`Resets ${when}`);
    await expect(banner).toHaveAttribute("data-variant", "warning");
    await expect(panel.getByRole("button", { name: "Resume thread" })).toBeVisible();

    await say(panel, "and again");
    await expect(panel.locator("[data-role='assistant']").last()).toContainText("Back under the limit.");
    await expect(line).toHaveCount(0);
    await expect(banner).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Resume thread" })).toHaveCount(0);
  });
});
