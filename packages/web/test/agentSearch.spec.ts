import { openCanvas } from "./canvas.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, createChat, engineChat, expect, openRail, sendThrough, tabs, test } from "./agent.ts";

test("search finds chats by what was said, marks the match, and a chosen result is active even when the selection hides it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, artifactColumn([{ id: "shape:p1", title: "Alpha" }, { id: "shape:p2", title: "Beta" }]));
  const tagged = await createChat(agent, { tags: ["shape:p1"], createdAt: "2026-09-01T10:00:00.000Z" });
  await sendThrough(agent, tagged, "where is the lantern kept?");
  const loose = await createChat(agent, { createdAt: "2026-09-02T10:00:00.000Z" });
  await sendThrough(agent, loose, "name this chat please");
  await expect.poll(async () => [(await engineChat(agent, tagged)).title, (await engineChat(agent, loose)).title]).toEqual(["What is on the board", "A named conversation"]);

  await openCanvas(page, agent);
  const panel = await openRail(page);
  await clickShape(page, "shape:p2");
  await expect(tabs(page)).toHaveCount(0);

  await panel.getByRole("button", { name: "Search chats" }).click();
  const field = panel.getByRole("searchbox", { name: "Search chats" }).or(panel.getByRole("textbox", { name: "Search chats" }));
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("placeholder", "Search chats");
  await field.pressSequentially("l");
  await expect(panel.getByRole("listbox", { name: "Search results" })).toHaveCount(0);
  await field.pressSequentially("antern");
  const results = panel.getByRole("option");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toHaveText("What is on the boardYou: where is the lantern kept?");
  await expect(results.first().locator("b")).toHaveText("lantern");

  // A match in the agent's reply reads "Agent:".
  await field.fill("named.");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toHaveText("A named conversationAgent: Named.");

  await field.fill("zzz nothing");
  await expect(panel.getByText("No chats match.", { exact: true })).toBeVisible();

  await field.fill("lantern");
  await results.first().click();
  await expect(field).toHaveCount(0);
  await expect(tabs(page)).toHaveText(["What is on the board"]);
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator("[data-role='user']")).toContainText("where is the lantern kept?");

  // The next selection change ends it: the filter applies again.
  await clickShape(page, "shape:p1");
  await expect(tabs(page)).toHaveText(["What is on the board"]);
  await clickShape(page, "shape:p2");
  await expect(tabs(page)).toHaveCount(0);

  // Cmd+K opens the search while focus is in the rail; Escape closes it.
  await panel.getByRole("button", { name: "Search chats" }).focus();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
});
