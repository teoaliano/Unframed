import { openCanvas } from "./canvas.ts";
import { createChat, expect, openRail, sendThrough, tabs, test } from "./agent.ts";

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

  // An inline tab chosen again leaves the More trigger reading More.
  await tabs(page).nth(1).click();
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("button", { name: "More chats" })).toHaveText("More");
});
