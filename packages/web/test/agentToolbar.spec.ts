import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { emptyCanvasPoint, openCanvas } from "./canvas.ts";
import { clickShape, composer, toolbar } from "./generation.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, createChat, engineChat, engineChats, expect, promptBox, rail, startDetectingEngine, test, userTexts } from "./agent.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

/** Alpha and Beta pages; "About alpha" knows Alpha, the newer "About both" knows both. */
const twoPages = async (page: Page, engine: TestEngine): Promise<{ alpha: string; both: string }> => {
  await openCanvas(page, engine);
  await putRecords(
    engine,
    artifactColumn([
      { id: "shape:p1", title: "Alpha" },
      { id: "shape:p2", title: "Beta" },
    ]),
  );
  const alpha = await createChat(engine, { title: "About alpha", tags: ["shape:p1"], createdAt: at(1) });
  const both = await createChat(engine, { title: "About both", tags: ["shape:p1", "shape:p2"], createdAt: at(2) });
  await openCanvas(page, engine);
  return { alpha, both };
};

const target = (page: Page) => composer(page).getByTestId("agent-target");
const chips = (page: Page) => composer(page).getByRole("list", { name: "Context" }).getByRole("listitem");

test("Agent on the toolbar is filled, and opens the Agent tray saying which chat the message continues, with the switch", async ({ page, agent }) => {
  await twoPages(page, agent);
  await clickShape(page, "shape:p1");
  const button = toolbar(page).getByRole("button", { name: "Agent" });
  await expect(button).toHaveClass(/unframed-bar-button--primary/);
  await expect(button.locator("svg")).toHaveCount(1);
  await button.click();

  await expect(composer(page)).toHaveAttribute("data-tray", "agent");
  await expect(target(page).locator(".unframed-agent-target__line")).toHaveText("continues About both");
  await expect(target(page).locator("em")).toHaveText("About both");
  await expect(composer(page).getByText("Claude · not metered", { exact: true })).toBeVisible();
  await target(page).getByRole("button", { name: "New chat instead" }).click();
  await expect(target(page).locator(".unframed-agent-target__line")).toHaveText("new chat");
  await target(page).getByRole("button", { name: "Continue the earlier chat" }).click();
  await expect(target(page).locator(".unframed-agent-target__line")).toHaveText("continues About both");

  // Back to tools (Esc) closes it; so does Escape.
  await target(page).getByRole("button", { name: "Back to tools (Esc)" }).click();
  await expect(composer(page)).toHaveCount(0);
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(composer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await expect(toolbar(page).getByRole("button", { name: "Agent" })).toBeVisible();

  // Nothing the chats know selected: a new chat, and nothing to switch to.
  await clickShape(page, "shape:starter-subject");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(target(page).locator(".unframed-agent-target__line")).toHaveText("new chat");
  await expect(target(page).getByRole("button", { name: "Continue the earlier chat" })).toHaveCount(0);
});

test("while the tray is open a clicked shape joins the context and stays selected; clicking empty canvas closes the tray", async ({ page, agent }) => {
  await twoPages(page, agent);
  await clickShape(page, "shape:p1");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(chips(page)).toHaveText(["Alpha"]);
  await expect(target(page).locator(".unframed-agent-target__line")).toHaveText("continues About both");

  await clickShape(page, "shape:p2");
  await expect(chips(page)).toHaveText(["Alpha", "Beta"]);
  await clickShape(page, "shape:p1");
  await expect(chips(page)).toHaveText(["Alpha", "Beta"]);
  await promptBox(composer(page)).click();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);

  // Both stayed selected: the tray opens on them again.
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(chips(page)).toHaveText(["Alpha", "Beta"]);
  const empty = await emptyCanvasPoint(page);
  await page.mouse.click(empty.x, empty.y);
  await expect(composer(page)).toHaveCount(0);
});

test("Send opens the rail on the chat it continues, then the message goes there; a new chat is tagged with the selected artifacts", async ({ page, agent }) => {
  const { both } = await twoPages(page, agent);
  await clickShape(page, "shape:p1");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await promptBox(composer(page)).pressSequentially("what is on this page?");
  await promptBox(composer(page)).press("Enter");
  await expect(composer(page)).toHaveCount(0);
  await expect(rail(page)).toBeVisible();
  await expect(rail(page).getByRole("tab", { selected: true })).toContainText("About both");
  await expect(rail(page).locator("[data-role='user']").last()).toContainText("what is on this page?");
  await expect(rail(page).locator("[data-role='assistant']").last()).not.toBeEmpty();
  expect(await userTexts(agent, both)).toEqual(["what is on this page?"]);

  await expect(toolbar(page).getByRole("button", { name: "Agent" })).toBeVisible();
  await clickShape(page, "shape:p2");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(chips(page)).toHaveText(["Beta"]);
  await target(page).getByRole("button", { name: "New chat instead" }).click();
  await promptBox(composer(page)).pressSequentially("start over on beta");
  await promptBox(composer(page)).press("Enter");
  await expect(rail(page).locator("[data-role='user']").last()).toContainText("start over on beta");
  const fresh = (await engineChats(agent)).find((chat) => chat.preview.startsWith("start over on beta"))!;
  expect((await engineChat(agent, fresh.id)).tags).toEqual(["shape:p2"]);
  await expect(rail(page).getByRole("tab", { selected: true })).toHaveAttribute("data-chat-id", fresh.id);
});

test("with no provider ready, the toolbar's Agent tooltip is the provider's message", async ({ page }) => {
  const engine = await startDetectingEngine(await mkdtemp(join(tmpdir(), "unframed-agent-toolbar-")));
  try {
    await openCanvas(page, engine);
    await clickShape(page, "shape:starter-subject");
    // The first hover asks for the statuses; the tooltip reads the message once they are in.
    await toolbar(page).getByRole("button", { name: "Agent" }).hover();
    await expect(toolbar(page).getByRole("button", { name: "Agent" })).toHaveAttribute("title", "Claude is not installed or not on PATH.", { timeout: 15_000 });
  } finally {
    await engine.dispose();
  }
});
