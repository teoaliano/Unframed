import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { emptyCanvasPoint, openCanvas } from "./canvas.ts";
import { clickShape, composer, toolbar } from "./generation.ts";
import { putRecords } from "./media.ts";
import { artifactColumn, createChat, engineChat, engineChats, expect, promptBox, rail, startDetectingEngine, test, userTexts } from "./agent.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expectSlot, expectToken, inBothSchemes } from "./kit.ts";
import { artifactShape } from "./artifacts.ts";

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

/**
 * Alpha and Beta pages, Beta far enough below Alpha that the tray opened on Alpha leaves it
 * clear; "About alpha" knows Alpha, the newer "About both" knows both.
 */
const twoPages = async (page: Page, engine: TestEngine): Promise<{ alpha: string; both: string }> => {
  await openCanvas(page, engine);
  const [alpha1, beta] = artifactColumn([
    { id: "shape:p1", title: "Alpha" },
    { id: "shape:p2", title: "Beta" },
  ]);
  await putRecords(engine, [alpha1, { ...beta!, y: 520 }]);
  const alpha = await createChat(engine, { title: "About alpha", tags: ["shape:p1"], createdAt: at(1) });
  const both = await createChat(engine, { title: "About both", tags: ["shape:p1", "shape:p2"], createdAt: at(2) });
  await openCanvas(page, engine);
  return { alpha, both };
};

const target = (page: Page) => composer(page).getByTestId("agent-target");
const chips = (page: Page) => composer(page).getByRole("list", { name: "Context" }).getByRole("listitem");

test("an empty page's bar is Agent alone, with no separator before it; its tray has one frame", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, [artifactShape({ id: "shape:empty", kind: "page", ref: "170", at: { x: 0, y: 0 } })]);
  await clickShape(page, "shape:empty");
  await expect(toolbar(page).getByRole("button")).toHaveText(["Agent"]);
  await expect(toolbar(page).locator("[data-slot='separator']")).toBeHidden();
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(promptBox(composer(page))).toBeVisible();
  // The tray draws its own shell; the floating element around it draws none.
  await expect(toolbar(page)).toHaveCSS("border-top-width", "0px");
  await expect(toolbar(page)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // The prompt box hugs its placeholder, then scrolls from its 180 px cap.
  const scroller = composer(page).locator("[data-scrolls='true']").first();
  const fits = () => scroller.evaluate((element) => element.scrollHeight <= element.clientHeight);
  expect(await fits()).toBe(true);
  await promptBox(composer(page)).click();
  for (let line = 0; line < 12; line++) await page.keyboard.press("Shift+Enter");
  expect(await fits()).toBe(false);
  expect((await scroller.boundingBox())!.height).toBe(180);
});

test("Agent on the toolbar is an outline button, and opens the Agent tray saying which chat the message continues, with the switch", async ({ page, agent }) => {
  await twoPages(page, agent);
  await clickShape(page, "shape:p1");
  const button = toolbar(page).getByRole("button", { name: "Agent" });
  await expectSlot(button, "button");
  await page.mouse.move(10, 10);
  await expectToken(button, "background-color", "--popover");
  await expect(button.locator("svg")).toHaveCount(1);
  await button.click();

  await expect(composer(page)).toHaveAttribute("data-tray", "agent");
  await expect(target(page).getByTestId("agent-target-line")).toHaveText("continues About both");
  await expect(target(page).locator("em")).toHaveText("About both");
  await expect(composer(page).getByText("Claude · not metered", { exact: true })).toBeVisible();
  await target(page).getByRole("button", { name: "New chat instead" }).click();
  await expect(target(page).getByTestId("agent-target-line")).toHaveText("new chat");
  await target(page).getByRole("button", { name: "Continue the earlier chat" }).click();
  await expect(target(page).getByTestId("agent-target-line")).toHaveText("continues About both");

  // Back to tools (Esc) closes it; so does Escape.
  await target(page).getByRole("button", { name: "Back to tools (Esc)" }).click();
  await expect(composer(page)).toHaveCount(0);
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  // The box takes the keyboard as the tray opens; Escape from there closes it.
  await expect(promptBox(composer(page))).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await expect(toolbar(page).getByRole("button", { name: "Agent" })).toBeVisible();

  // Nothing the chats know selected: a new chat, and nothing to switch to.
  await clickShape(page, "shape:starter-subject");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(target(page).getByTestId("agent-target-line")).toHaveText("new chat");
  await expect(target(page).getByRole("button", { name: "Continue the earlier chat" })).toHaveCount(0);
});

test("while the tray is open a clicked shape joins the context and stays selected; clicking empty canvas closes the tray", async ({ page, agent }) => {
  await twoPages(page, agent);
  await clickShape(page, "shape:p1");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(chips(page)).toHaveText(["Alpha"]);
  await expect(target(page).getByTestId("agent-target-line")).toHaveText("continues About both");

  await clickShape(page, "shape:p2");
  await expect(chips(page)).toHaveText(["Alpha", "Beta"]);
  // Again, past tldraw's double-click window: a double click would start a new prompt.
  await page.waitForTimeout(600);
  await clickShape(page, "shape:p2");
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

test("the toolbar's tray says what went wrong itself, since the rail is closed", async ({ page, agent }) => {
  await twoPages(page, agent);
  await clickShape(page, "shape:p1");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(target(page)).toBeVisible();
  // Under the chips: the line saying which chat this joins.
  expect(await composer(page).evaluate((element) => {
    const chipRow = element.querySelector("[aria-label='Context']")!;
    const line = element.querySelector("[data-testid='agent-target']")!;
    return chipRow.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING;
  })).toBeTruthy();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(51 * 1024 * 1024)], "huge.bin", { type: "application/octet-stream" }));
    const tray = document.querySelector("[data-testid='composer'] [data-testid='agent-tray']")!;
    for (const type of ["dragenter", "drop"]) tray.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(composer(page).getByRole("alert")).toHaveText("'huge.bin' exceeds the 50 MB attachment limit.");
  await expect(rail(page)).toHaveCount(0);
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
