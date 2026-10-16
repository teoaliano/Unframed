import type { Page } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { agentChromeButton, artifactColumn, createChat, engineChat, engineChats, expect, openRail, rail, sendThrough, tabs, test } from "./agent.ts";

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

/** Every tab and the More trigger sit inside the rail's right edge: nothing spills onto the canvas. */
const expectInsideRail = async (page: Page) => {
  const edges = await rail(page).evaluate((element) => {
    const strip = element.querySelector("[data-testid='chat-tabs']")!;
    return { rail: element.getBoundingClientRect().right, items: [...strip.children].map((child) => child.getBoundingClientRect().right) };
  });
  expect(edges.items.length).toBeGreaterThan(0);
  for (const right of edges.items) expect(right).toBeLessThanOrEqual(edges.rail + 0.5);
};

const TITLES = ["Video to loading animation", "Brand palette", "Hero copy", "Pricing page", "Checkout flow", "Footer links", "Onboarding email", "Release notes"];

test("as many tabs as fit show, the rest wait under More with their count, and a chat chosen from More becomes a tab", async ({ page, agent }) => {
  await openCanvas(page, agent);
  for (const [index, title] of TITLES.entries()) await createChat(agent, { title, createdAt: at(index + 2) });
  // The oldest chat is parked on an approval, so it keeps running, and it sits under More.
  const oldest = await createChat(agent, { title: "Oldest running", createdAt: at(1), runtimeMode: "approval-required" });
  await sendThrough(agent, oldest, "clean the build please");

  const panel = await openRail(page);
  const more = panel.getByRole("button", { name: "More chats" });
  const shown = await tabs(page).count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(TITLES.length + 1);
  await expect(more).toHaveText(`More (${TITLES.length + 1 - shown})`);
  await expectInsideRail(page);
  // The newest chat is the active one, and it is always a tab.
  await expect(tabs(page).filter({ hasText: "Release notes" })).toHaveAttribute("aria-selected", "true");

  await more.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(TITLES.length + 1 - shown);
  await expect(menu.getByRole("menuitem", { name: "Oldest running" }).getByTestId("chat-status")).toHaveAttribute("data-status", "running");
  await menu.getByRole("menuitem", { name: "Brand palette" }).click();
  await expect(tabs(page).filter({ hasText: "Brand palette" })).toHaveAttribute("aria-selected", "true");
  await expect(more).toHaveText(`More (${TITLES.length + 1 - (await tabs(page).count())})`);
  await expectInsideRail(page);
});

test.describe("on a narrow window", () => {
  test.use({ viewport: { width: 360, height: 720 } });

  test("the tabs stay inside the Sheet, and they are measured again when the Sheet widens", async ({ page, agent }) => {
    await openCanvas(page, agent);
    for (const [index, title] of TITLES.entries()) await createChat(agent, { title, createdAt: at(index + 2) });
    await agentChromeButton(page).click();
    const sheet = page.locator("[data-slot='sheet-popup']");
    await expect(sheet).toBeVisible();
    // Once it has slid in, it meets the left edge.
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.x)).toBe(0);
    const panel = rail(page);
    const narrow = await tabs(page).count();
    expect(narrow).toBeLessThan(TITLES.length);
    await expectInsideRail(page);

    // At 600 px the Sheet is its 384 px maximum wide: more tabs fit.
    await page.setViewportSize({ width: 600, height: 720 });
    await expect.poll(async () => tabs(page).count()).toBeGreaterThan(narrow);
    await expectInsideRail(page);
    await expect(panel.getByRole("button", { name: "More chats" })).toHaveText(`More (${TITLES.length - (await tabs(page).count())})`);

    // Choosing a chat from More changes which tabs show, and the new set still fits.
    await panel.getByRole("button", { name: "More chats" }).click();
    await page.getByRole("menu").getByRole("menuitem").first().click();
    await expectInsideRail(page);
  });
});

test("a tab's status: a spinner while its turn runs, a checkmark once it finished unseen, a warning when it failed, nothing when idle or once viewed", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await createChat(agent, { title: "Idle one", createdAt: at(1) });
  const done = await createChat(agent, { title: "Done one", createdAt: at(2) });
  const failed = await createChat(agent, { title: "Failed one", createdAt: at(3) });
  // The newest chat is parked on an approval, so its turn keeps running, and it is the active tab.
  const running = await createChat(agent, { title: "Running one", createdAt: at(4), runtimeMode: "approval-required" });
  await sendThrough(agent, running, "clean the build please");

  await openRail(page);
  const tab = (name: string) => tabs(page).filter({ hasText: name });
  await expect(tab("Running one").getByTestId("chat-status")).toHaveAttribute("data-status", "running");
  await expect(tab("Idle one").getByTestId("chat-status")).toHaveCount(0);

  // The active chat is viewed, so a turn that finishes in it leaves no checkmark; the others keep one until viewed.
  await sendThrough(agent, done, "show me the formatting");
  await expect(tab("Done one").getByTestId("chat-status")).toHaveAttribute("data-status", "finished");
  await sendThrough(agent, failed, "break it");
  await expect(tab("Failed one").getByTestId("chat-status")).toHaveAttribute("data-status", "failed");

  await tab("Done one").click();
  await expect(tab("Done one")).toHaveAttribute("aria-selected", "true");
  await expect(tab("Done one").getByTestId("chat-status")).toHaveCount(0);
  await expect(tab("Failed one").getByTestId("chat-status")).toHaveAttribute("data-status", "failed");
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
  await expect(page.locator("[data-slot='toast-title']").filter({ hasText: "Deleted 3 chats" })).toBeVisible();
  await expect(page.locator("[data-slot='toast-description']").filter({ hasText: "1 running chat was kept." })).toBeVisible();
  // The dialog's backdrop fades out over the canvas: wait for it before clicking there.
  await expect(page.locator("[data-slot='alert-dialog-backdrop']")).toHaveCount(0);
  // Shift-click takes the artifact out of the selection: with nothing selected the running chat shows.
  await clickShape(page, "shape:p1", ["Shift"]);
  await expect(tabs(page)).toHaveText(["Cleaner"]);
  await expect.poll(async () => (await engineChats(agent)).map((chat) => chat.id)).toEqual([running]);
  // Only the running chat is left, so there is nothing idle to clear.
  const clear = panel.getByRole("button", { name: "Clear all chats" });
  await expect(clear).toBeDisabled();
  // Disabled, it still says why on hover, and a click does nothing.
  await clear.hover();
  await expect(page.locator("[data-slot='tooltip-popup']")).toHaveText("Every chat is still running");
  await clear.click({ force: true });
  await expect(confirm).toHaveCount(0);
});

test("chats under More have the same menu: right-click a row, or click the active one; right-clicks in the rail never open the canvas menu", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:p1", title: "Alpha" }]));
  const oldest = await createChat(agent, { title: "First", tags: ["shape:p1"], createdAt: at(1) });
  for (const [index, title] of ["Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth"].entries()) await createChat(agent, { title, createdAt: at(index + 2) });
  await openCanvas(page, agent);
  const panel = await openRail(page);
  // The oldest chat is the one that does not fit, so it waits under More.
  await expect(tabs(page).first()).toHaveText("Ninth");
  await expect(tabs(page).filter({ hasText: "First" })).toHaveCount(0);
  const canvasMenu = page.getByRole("menuitem", { name: /Select all/ });

  // A right-click on a row under More chooses it, so it becomes a tab, and opens its menu, named for it.
  await panel.getByRole("button", { name: "More chats" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "First" }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "First actions" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Rename", "Detach from Alpha", "Delete"]);
  await expect(tabs(page).filter({ hasText: "First" })).toHaveAttribute("aria-selected", "true");
  await expect(canvasMenu).toHaveCount(0);

  // Rename puts the field on the tab it has become.
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const rename = panel.getByRole("textbox", { name: "Rename chat" });
  await expect(rename).toBeFocused();
  await rename.fill("Oldest");
  await rename.press("Enter");
  await expect.poll(async () => (await engineChat(agent, oldest)).title).toBe("Oldest");
  await expect(tabs(page).filter({ hasText: "Oldest" })).toHaveAttribute("aria-selected", "true");

  // Anywhere else in the rail opens nothing.
  await panel.getByTestId("transcript").click({ button: "right" });
  await panel.getByRole("heading", { name: "Agent" }).click({ button: "right" });
  await expect(canvasMenu).toHaveCount(0);
});
