import { openCanvas } from "./canvas.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, createChat, engineChat, engineChats, expect, openRail, sendThrough, tabs, test } from "./agent.ts";

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

test("three tabs inline and the rest under More, whose trigger names the active chat; a live dot on a running chat; the tooltip", async ({ page, agent }) => {
  await openCanvas(page, agent);
  for (const [index, title] of ["First", "Second", "Third", "Fourth"].entries()) await createChat(agent, { title, createdAt: at(index + 1) });
  // The newest chat is parked on an approval, so its turn keeps running.
  const running = await createChat(agent, { title: "Cleaner", createdAt: at(9), runtimeMode: "approval-required" });
  await sendThrough(agent, running, "clean the build please");

  const panel = await openRail(page);
  await expect(tabs(page)).toHaveText(["Cleaner", "Fourth", "Third"]);
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs(page).first().getByTestId("live-dot")).toBeVisible();
  await expect(tabs(page).nth(1).getByTestId("live-dot")).toHaveCount(0);

  await tabs(page).first().hover();
  await expect(page.getByText("Cleaner · clean the build please", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "More chats" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Second", "First"]);
  await menu.getByRole("menuitem", { name: "First" }).click();
  await expect(panel.getByRole("button", { name: "More chats: First" })).toHaveText("First");
  await expect(tabs(page).and(page.locator("[aria-selected='true']"))).toHaveCount(0);

  // A chat under More cannot be renamed there: its row is a menu item, not a tab.
  await panel.getByRole("button", { name: "More chats" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Second" }).dblclick();
  await expect(panel.getByRole("textbox", { name: "Rename chat" })).toHaveCount(0);

  // An inline tab chosen again leaves the More trigger reading More.
  await tabs(page).nth(1).click();
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("button", { name: "More chats" })).toHaveText("More");
});

test("double-click renames a tab in place: Enter and blur commit, Escape abandons, an empty name falls back to the default", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const chatId = await createChat(agent);
  await sendThrough(agent, chatId, "name this chat please");
  const panel = await openRail(page);
  await expect(tabs(page)).toHaveText(["A named conversation"]);
  const rename = panel.getByRole("textbox", { name: "Rename chat" });

  await tabs(page).first().dblclick();
  await expect(rename).toBeFocused();
  await expect(rename).toHaveAttribute("data-slot", "input");
  await expect(rename).toHaveValue("A named conversation");
  await rename.fill("Brief");
  await rename.press("Enter");
  await expect(rename).toHaveCount(0);
  await expect(tabs(page)).toHaveText(["Brief"]);
  await expect.poll(async () => (await engineChat(agent, chatId)).title).toBe("Brief");
  expect((await engineChat(agent, chatId)).titledBy).toBe("user");

  await tabs(page).first().dblclick();
  await rename.fill("Not this");
  await rename.press("Escape");
  await expect(rename).toHaveCount(0);
  await expect(tabs(page)).toHaveText(["Brief"]);

  await tabs(page).first().dblclick();
  await rename.fill("Blurred");
  await panel.getByRole("heading", { name: "Agent" }).click();
  await expect(tabs(page)).toHaveText(["Blurred"]);
  await expect.poll(async () => (await engineChat(agent, chatId)).title).toBe("Blurred");

  // Clearing the name lets the tab fall back to the opening words, and the agent may name it again.
  await tabs(page).first().dblclick();
  await rename.fill("");
  await rename.press("Enter");
  await expect(tabs(page)).toHaveText(["name this chat please"]);
  await expect.poll(async () => (await engineChat(agent, chatId)).titledBy).toBeNull();
});

test("a right-click on a tab, or a click on the active one, opens Rename and Delete; Delete asks first", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const first = await createChat(agent, { title: "First", createdAt: at(1) });
  const second = await createChat(agent, { title: "Second", createdAt: at(2) });
  const panel = await openRail(page);
  await expect(tabs(page)).toHaveText(["Second", "First"]);

  // A right-click on the inactive tab chooses it and opens its menu.
  await tabs(page).nth(1).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "First actions" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Rename", "Delete"]);
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const rename = panel.getByRole("textbox", { name: "Rename chat" });
  await expect(rename).toBeFocused();
  await rename.fill("Renamed");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await engineChat(agent, first)).title).toBe("Renamed");

  // A click on the active tab opens the same menu; Delete confirms, then removes that chat.
  await tabs(page).filter({ hasText: "Renamed" }).click();
  await page.getByRole("menu", { name: "Renamed actions" }).getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this chat?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Delete chat" }).click();
  await expect(tabs(page)).toHaveText(["Second"]);
  expect((await engineChat(agent, second)).title).toBe("Second");
});

test("Clear all chats deletes every idle chat of the project, the hidden ones too, after a confirmation that counts them, and keeps a running one", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:p1", title: "Alpha" }]));
  await createChat(agent, { title: "Older", createdAt: at(1) });
  await createChat(agent, { title: "About alpha", tags: ["shape:p1"], createdAt: at(2) });
  await createChat(agent, { title: "Loose", createdAt: at(3) });
  const running = await createChat(agent, { title: "Cleaner", createdAt: at(4), runtimeMode: "approval-required" });
  await sendThrough(agent, running, "clean the build please");
  await openCanvas(page, agent);
  const panel = await openRail(page);

  // The selection hides two of the chats; Clear all still counts and deletes them.
  await clickShape(page, "shape:p1");
  await expect(tabs(page)).toHaveText(["About alpha"]);
  await panel.getByRole("button", { name: "Clear all chats" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Clear all chats?" });
  await expect(confirm).toContainText("This deletes 3 chats for good. 1 running chat is kept and finishes its turn. What the agent changed on the canvas stays.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expect(await engineChats(agent)).toHaveLength(4);

  await panel.getByRole("button", { name: "Clear all chats" }).click();
  await confirm.getByRole("button", { name: "Delete 3 chats" }).click();
  await expect(tabs(page)).toHaveCount(0);
  // The dialog's backdrop fades out over the canvas: wait for it before clicking there.
  await expect(page.locator("[data-slot='alert-dialog-backdrop']")).toHaveCount(0);
  // Shift-click takes the artifact out of the selection: with nothing selected the running chat shows.
  await clickShape(page, "shape:p1", ["Shift"]);
  await expect(tabs(page)).toHaveText(["Cleaner"]);
  await expect.poll(async () => (await engineChats(agent)).map((chat) => chat.id)).toEqual([running]);
  // Only the running chat is left, so there is nothing idle to clear.
  await expect(panel.getByRole("button", { name: "Clear all chats" })).toBeDisabled();
});
