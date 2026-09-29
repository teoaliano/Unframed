import { openCanvas } from "./canvas.ts";
import { expect, onlyChat, openRail, promptBox, tabs, test } from "./agent.ts";

test("typing and Enter starts a chat: the message shows at once, the reply streams in and the tab gets its name; Shift+Enter breaks the line", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  await expect(panel.getByText("No chats yet", { exact: true })).toBeVisible();
  const box = promptBox(panel);
  await box.click();
  await box.pressSequentially("what is on the board?");
  await box.press("Shift+Enter");
  await box.pressSequentially("in short");
  await expect(panel.locator("[data-role='user']")).toHaveCount(0);

  await box.press("Enter");
  await expect(panel.locator("[data-role='user'] .unframed-agent-message__text")).toHaveText("what is on the board?\nin short");
  await expect(box).toHaveText("");
  await expect(panel.locator("[data-role='assistant']")).toContainText("Three shapes: motion m1");
  await expect(panel.locator("[data-role='assistant'] header")).toHaveText("Claude");
  await expect(tabs(page)).toHaveText(["What is on the board"]);
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");

  const chat = await onlyChat(agent, (current) => current.latestTurn?.state === "completed");
  expect(chat.messages.filter((message) => message.role === "user").map((message) => message.text)).toEqual(["what is on the board?\nin short"]);
  expect(chat.title).toBe("What is on the board");
});
