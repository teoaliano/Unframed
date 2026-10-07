import { emptyCanvasPoint, openCanvas } from "./canvas.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, createChat, engineChat, expect, openRail, tabs, test } from "./agent.ts";

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

test("selecting artifacts filters the tabs to the chats tagged with any of them, with the empty strip's copy, and the active tab stays visible", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(
    agent,
    artifactColumn([
      { id: "shape:p1", title: "Alpha" },
      { id: "shape:p2", title: "Beta" },
      { id: "shape:p3", title: "Gamma" },
      { id: "shape:p4", title: "Delta" },
    ]),
  );
  await createChat(agent, { title: "About alpha", tags: ["shape:p1"], createdAt: at(1) });
  await createChat(agent, { title: "About beta", tags: ["shape:p2"], createdAt: at(2) });
  await createChat(agent, { title: "About both", tags: ["shape:p1", "shape:p2"], createdAt: at(3) });
  await createChat(agent, { title: "Loose", createdAt: at(4) });
  // Opened again, the view fits the new shapes too.
  await openCanvas(page, agent);
  const panel = await openRail(page);
  await expect(tabs(page)).toHaveText(["Loose", "About both", "About beta"]);

  // Choose a chat, then select an artifact it is not about: the active tab moves to one that is shown.
  await tabs(page).filter({ hasText: "About beta" }).click();
  await clickShape(page, "shape:p1");
  await expect(tabs(page)).toHaveText(["About both", "About alpha"]);
  await expect(tabs(page).filter({ hasText: "About both" })).toHaveAttribute("aria-selected", "true");

  // Any of the selected artifacts: two selected show the chats about either.
  await clickShape(page, "shape:p2", ["Shift"]);
  await expect(tabs(page)).toHaveText(["About both", "About beta", "About alpha"]);

  // Two artifacts nobody has talked about: the strip says the first message starts a chat.
  await clickShape(page, "shape:p3");
  await clickShape(page, "shape:p4", ["Shift"]);
  await expect(tabs(page)).toHaveCount(0);
  await expect(panel.getByText("Nothing said about these yet. Your first message starts a chat.", { exact: true })).toBeVisible();

  // Exactly one: the strip says nothing, since the composer already asks for the first message.
  await clickShape(page, "shape:p3");
  await expect(tabs(page)).toHaveCount(0);
  await expect(panel.getByTestId("chat-tabs")).toHaveText("");

  // Nothing selected shows every chat again.
  const empty = await emptyCanvasPoint(page);
  await page.mouse.click(empty.x - 300, empty.y);
  await expect(tabs(page)).toHaveText(["Loose", "About both", "About beta"]);
});

test("Detach unlinks one artifact from a chat, picked from a submenu when there are several, and the tab leaves the filter for it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(
    agent,
    artifactColumn([
      { id: "shape:p1", title: "Alpha" },
      { id: "shape:m1", kind: "motion", title: "Beta" },
    ]),
  );
  const alpha = await createChat(agent, { title: "About alpha", tags: ["shape:p1"], createdAt: at(1) });
  const both = await createChat(agent, { title: "About both", tags: ["shape:p1", "shape:m1"], createdAt: at(2) });
  await createChat(agent, { title: "Loose", createdAt: at(3) });
  await openCanvas(page, agent);
  await openRail(page);
  await clickShape(page, "shape:p1");
  await expect(tabs(page)).toHaveText(["About both", "About alpha"]);

  // Linked to two artifacts: Detach from opens a submenu naming them.
  await tabs(page).filter({ hasText: "About both" }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "About both actions" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Rename", "Detach from", "Delete"]);
  await menu.getByRole("menuitem", { name: "Detach from" }).click();
  const pick = page.getByRole("menu", { name: "Detach from" });
  await expect(pick.getByRole("menuitem")).toHaveText(["Alpha", "Beta"]);
  await pick.getByRole("menuitem", { name: "Alpha" }).click();
  await expect(tabs(page)).toHaveText(["About alpha"]);
  await expect.poll(async () => (await engineChat(agent, both)).tags).toEqual(["shape:m1"]);

  // Linked to one: a single item names it.
  await tabs(page).filter({ hasText: "About alpha" }).click({ button: "right" });
  await page.getByRole("menu", { name: "About alpha actions" }).getByRole("menuitem", { name: "Detach from Alpha" }).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect.poll(async () => (await engineChat(agent, alpha)).tags).toEqual([]);

  // Detach removes a link, not a chat: the motion still finds the chat it stays linked to.
  await clickShape(page, "shape:m1");
  await expect(tabs(page)).toHaveText(["About both"]);
});

test("Detach works from the keyboard, says what it did in a toast whose Undo links the artifact again, and a long title is cut to the menu's width", async ({ page, agent }) => {
  const long = "A very long landing page title for the autumn campaign hero and gallery section";
  await openCanvas(page, agent);
  await putRecords(
    agent,
    artifactColumn([
      { id: "shape:p1", title: "Alpha" },
      { id: "shape:m1", kind: "motion", title: "Beta" },
      { id: "shape:p2", title: long },
    ]),
  );
  const both = await createChat(agent, { title: "About both", tags: ["shape:p1", "shape:m1"], createdAt: at(1) });
  await createChat(agent, { title: "Long one", tags: ["shape:p2"], createdAt: at(2) });
  await openCanvas(page, agent);
  await openRail(page);
  await expect(tabs(page)).toHaveText(["Long one", "About both"]);

  // The menu keeps its width; the title is cut with an ellipsis and shown whole on hover.
  await tabs(page).filter({ hasText: "Long one" }).click({ button: "right" });
  const longMenu = page.getByRole("menu", { name: "Long one actions" });
  const item = longMenu.getByRole("menuitem", { name: `Detach from ${long}` });
  await expect(item).toBeVisible();
  expect((await longMenu.boundingBox())!.width).toBeLessThanOrEqual(260);
  await item.hover();
  await expect(page.locator("[data-slot='tooltip-popup']")).toHaveText(long);
  await page.keyboard.press("Escape");
  await expect(longMenu).toHaveCount(0);

  // Keyboard: ArrowRight on Detach from moves focus into the submenu, and Enter there detaches.
  await tabs(page).filter({ hasText: "About both" }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "About both actions" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Detach from" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const alpha = page.getByRole("menu", { name: "Detach from" }).getByRole("menuitem", { name: "Alpha" });
  await expect(alpha).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await engineChat(agent, both)).tags).toEqual(["shape:m1"]);

  // The toast says what was detached; Undo puts the link back.
  const toast = page.locator("[data-slot='toast-title']").filter({ hasText: "Detached from Alpha" });
  await expect(toast).toBeVisible();
  await page.locator("[data-slot='toast-action']").filter({ hasText: "Undo" }).click();
  await expect.poll(async () => (await engineChat(agent, both)).tags).toEqual(["shape:m1", "shape:p1"]);
  await expect(toast).toHaveCount(0);
});
