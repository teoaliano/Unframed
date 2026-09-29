import { openCanvas, roomShapes } from "./canvas.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, engineChats, expect, onlyChat, openRail, promptBox, say, tabs, test } from "./agent.ts";

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
  await expect(panel.locator("[data-role='user'] [data-testid='message-text']")).toHaveText("what is on the board?\nin short");
  await expect(box).toHaveText("");
  await expect(panel.locator("[data-role='assistant']")).toContainText("Three shapes: motion m1");
  await expect(panel.locator("[data-role='assistant'] header")).toHaveText("Claude");
  await expect(tabs(page)).toHaveText(["What is on the board"]);
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");

  const chat = await onlyChat(agent, (current) => current.latestTurn?.state === "completed");
  expect(chat.messages.filter((message) => message.role === "user").map((message) => message.text)).toEqual(["what is on the board?\nin short"]);
  expect(chat.title).toBe("What is on the board");
});

test("Delete asks first, then the chat is gone and what it changed on the canvas stays", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:m1", kind: "motion", title: "Intro" }, { id: "shape:m2", kind: "motion", title: "Outro" }]));
  const panel = await openRail(page);
  await expect(panel.getByRole("button", { name: "Delete chat" })).toBeDisabled();
  await say(panel, "make both titles red");
  await expect(panel.locator("[data-role='assistant']")).toContainText("Set both titles to red");
  await expect.poll(async () => (await roomShapes(agent, "default", "motion")).map((shape) => shape.props.title).sort()).toEqual(["Intro (red)", "Outro (red)"]);

  await panel.getByRole("button", { name: "Delete chat" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Delete this chat?", { exact: true })).toBeVisible();
  await expect(dialog.getByText("The conversation is removed for good. What the agent changed on the canvas stays.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(tabs(page)).toHaveCount(1);

  await panel.getByRole("button", { name: "Delete chat" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete chat" }).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(panel.getByText("No chats yet", { exact: true })).toBeVisible();
  await expect.poll(async () => (await engineChats(agent)).length).toBe(0);
  expect((await roomShapes(agent, "default", "motion")).map((shape) => shape.props.title).sort()).toEqual(["Intro (red)", "Outro (red)"]);
});
