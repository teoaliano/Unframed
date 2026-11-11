import type { Page } from "@playwright/test";
import { commentBody } from "@unframed/domain";
import { emptyCanvasPoint, openCanvas, roomRecords, shapeOnScreen, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { emptyMedia, putRecords } from "./media.ts";

const IMAGE = "shape:commented";

const thread = (id: string, anchor: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: `comment-thread:${id}`,
  typeName: "comment-thread",
  pageId: "page:page",
  anchor,
  createdBy: "person",
  createdAt: Date.now() - 60_000,
  resolved: null,
  isDeleted: false,
  meta: {},
  ...extra,
});

const message = (id: string, threadId: string, text: string, extra: Record<string, unknown> = {}) => ({
  id: `comment:${id}`,
  typeName: "comment",
  threadId: `comment-thread:${threadId}`,
  pageId: "page:page",
  authorId: "person",
  createdAt: Date.now() - 60_000,
  editedAt: null,
  body: commentBody(text),
  isDeleted: false,
  meta: {},
  ...extra,
});

const pin = (page: Page, id: string) => page.locator(`[data-comment-pin="comment-thread:${id}"]`);
const popover = (page: Page) => page.locator("[data-comment-thread]");
const sidebar = (page: Page) => page.getByRole("region", { name: "Comments" });

const comments = (records: AnyRecord[]) => records.filter((record) => record.typeName === "comment") as Array<AnyRecord & Record<string, any>>;
const threads = (records: AnyRecord[]) => records.filter((record) => record.typeName === "comment-thread") as Array<AnyRecord & Record<string, any>>;

const withImage = async (page: Page, engine: TestEngine) => {
  const project = await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia(IMAGE, "image", "300", { x: -380, y: 120 }, { w: 320, h: 200 })]);
  await expect(shapeOnScreen(page, IMAGE)).toBeVisible();
  return project;
};

const seeded = async (page: Page, engine: TestEngine, records: unknown[]) => {
  const project = await withImage(page, engine);
  await putRecords(engine, records);
  return project;
};

const commentMode = async (page: Page) => {
  await page.keyboard.press("c");
  await expect(sidebar(page)).toBeVisible();
};

test("a pin dropped on an image is stored on that image and follows it when it moves", async ({ page, engine }) => {
  const project = await withImage(page, engine);
  await commentMode(page);
  const box = (await shapeOnScreen(page, IMAGE).boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 50);
  const input = page.locator("[data-comment-new] textarea");
  await expect(input).toBeFocused();
  await expect(page.locator("[data-comment-new] [data-comment-send]")).toBeDisabled();
  await input.pressSequentially("Crop tighter");
  await input.press("Shift+Enter");
  await input.pressSequentially("and darker");
  await input.press("Enter");
  await expect(page.locator("[data-comment-new]")).toHaveCount(0);
  const stored = await waitForRoom(engine, project, (records) => {
    const [first] = threads(records);
    const [body] = comments(records);
    return first !== undefined && body !== undefined ? { first, body } : undefined;
  });
  expect(stored.first.anchor).toMatchObject({ type: "shape", shapeId: IMAGE, isPrecise: true });
  expect(stored.first.anchor.x).toBeCloseTo(80 / 320, 1);
  expect(stored.first.createdBy).toBe("person");
  expect(stored.first.meta).toEqual({ number: 1 });
  expect(stored.body.authorId).toBe("person");
  expect(stored.body.body).toEqual(commentBody("Crop tighter\nand darker"));

  const id = stored.first.id.slice("comment-thread:".length);
  const before = (await pin(page, id).boundingBox())!;
  expect(Math.abs(before.x - (box.x + 80))).toBeLessThan(3);
  expect(Math.abs(before.y + before.height - (box.y + 50))).toBeLessThan(3);

  const image = (await roomRecords(engine, project)).find((record) => record.id === IMAGE)!;
  await putRecords(engine, [{ ...image, x: (image.x ?? 0) + 200 }]);
  await expect.poll(async () => Math.round((await pin(page, id).boundingBox())!.x - before.x)).toBe(200);

  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(300);
  expect(threads(await roomRecords(engine, project))).toHaveLength(1);
});

test("a reply joins the thread; resolving hides the pin until Show resolved, and the thread reopens", async ({ page, engine }) => {
  const project = await seeded(page, engine, [thread("t1", { type: "point", x: 200, y: -60 }, { meta: { number: 1 } }), message("m1", "t1", "Make the sky darker")]);
  await expect(pin(page, "t1")).toBeVisible();
  await pin(page, "t1").click();
  await expect(popover(page)).toBeVisible();
  await expect(sidebar(page)).toBeVisible();
  await expect(popover(page)).toContainText("Make the sky darker");
  const reply = popover(page).locator("textarea");
  await expect(reply).toBeFocused();
  await reply.pressSequentially("On it");
  await reply.press("Enter");
  await expect(popover(page).locator("[data-comment-message]")).toHaveCount(2);
  await waitForRoom(engine, project, (records) => comments(records).length === 2);
  await expect(sidebar(page).locator("[data-comment-row]")).toContainText("1 reply");

  await popover(page).getByRole("button", { name: "Resolve" }).click();
  await expect(popover(page)).toHaveCount(0);
  await expect(pin(page, "t1")).toHaveCount(0);
  await waitForRoom(engine, project, (records) => threads(records)[0]?.resolved?.by === "person");
  await expect(sidebar(page).locator("[data-comment-row]")).toHaveCount(0);

  await sidebar(page).getByRole("button", { name: "Sort and filter" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show resolved comments" }).click();
  await page.keyboard.press("Escape");
  await expect(pin(page, "t1")).toBeVisible();
  await expect(pin(page, "t1")).toHaveAttribute("data-resolved", "");
  await sidebar(page).locator("[data-comment-row]").click();
  await expect(popover(page)).toBeVisible();
  await popover(page).getByRole("button", { name: "Reopen" }).click();
  await waitForRoom(engine, project, (records) => threads(records)[0]?.resolved === null);
});

test("dragging in comment mode comments on an area", async ({ page, engine }) => {
  const project = await openCanvas(page, engine);
  await commentMode(page);
  const start = await emptyCanvasPoint(page);
  await page.mouse.move(start.x - 120, start.y - 80);
  await page.mouse.down();
  await page.mouse.move(start.x - 40, start.y - 20, { steps: 4 });
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await expect(page.locator("[data-comment-region-drag]")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator("[data-comment-region]")).toBeVisible();
  const input = page.locator("[data-comment-new] textarea");
  await input.pressSequentially("This whole corner is empty");
  await input.press("Enter");
  const stored = await waitForRoom(engine, project, (records) => threads(records)[0]);
  expect(stored.anchor).toMatchObject({ type: "region", pinX: 1, pinY: 1 });
  expect(stored.anchor.w).toBeCloseTo(120, 0);
  expect(stored.anchor.h).toBeCloseTo(80, 0);
});

test("deleting a thread removes it with its replies", async ({ page, engine }) => {
  const project = await seeded(page, engine, [thread("t1", { type: "point", x: 200, y: -60 }), message("m1", "t1", "One"), message("m2", "t1", "Two")]);
  await pin(page, "t1").click();
  await popover(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete thread…" }).click();
  await popover(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(pin(page, "t1")).toHaveCount(0);
  await waitForRoom(engine, project, (records) => threads(records).length === 0 && comments(records).length === 0);
});

test("Shift+C hides and shows every pin", async ({ page, engine }) => {
  await seeded(page, engine, [thread("t1", { type: "point", x: 200, y: -60 }), message("m1", "t1", "One")]);
  await expect(pin(page, "t1")).toBeVisible();
  await page.keyboard.press("Shift+C");
  await expect(pin(page, "t1")).toHaveCount(0);
  await page.keyboard.press("Shift+C");
  await expect(pin(page, "t1")).toBeVisible();
});

test("the sidebar searches threads and pans to the one clicked", async ({ page, engine }) => {
  await seeded(page, engine, [
    thread("near", { type: "point", x: 200, y: -60 }),
    message("m1", "near", "Warmer light here"),
    thread("far", { type: "point", x: 6000, y: 4000 }),
    message("m2", "far", "Far away logo needs work"),
  ]);
  await commentMode(page);
  await expect(sidebar(page).locator("[data-comment-row]")).toHaveCount(2);
  await sidebar(page).getByRole("searchbox", { name: "Search comments" }).fill("logo");
  await expect(sidebar(page).locator("[data-comment-row]")).toHaveCount(1);
  await expect(pin(page, "far")).not.toBeInViewport();
  await sidebar(page).locator("[data-comment-row]").click();
  await expect(popover(page)).toContainText("Far away logo needs work");
  await expect(pin(page, "far")).toBeInViewport();
  await expect(sidebar(page).locator("[data-comment-row]")).toHaveAttribute("data-selected", "");
});

test("pins close together merge into a count when zoomed out, and a click zooms back in", async ({ page, engine }) => {
  await seeded(page, engine, [
    thread("a", { type: "point", x: 200, y: -60 }),
    message("ma", "a", "A"),
    thread("b", { type: "point", x: 250, y: -60 }),
    message("mb", "b", "B"),
    thread("c", { type: "point", x: 230, y: -20 }),
    message("mc", "c", "C"),
  ]);
  await expect(page.locator("[data-comment-pin]")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+Minus");
  const cluster = page.locator("[data-comment-cluster]");
  await expect(cluster).toHaveAttribute("data-comment-cluster", "3");
  await expect(cluster).toHaveText("3");
  await expect(page.locator("[data-comment-pin]")).toHaveCount(0);
  await cluster.hover();
  await expect(cluster.locator("[data-comment-avatar]")).toHaveCount(1);
  await cluster.click();
  await expect(page.locator("[data-comment-pin]")).toHaveCount(3);
});

test("an agent's thread shows the agent and counts as unread until opened", async ({ page, engine }) => {
  const agent = { authorId: "chat:x", meta: { author: { name: "Claude", provider: "claude" } } };
  await seeded(page, engine, [
    thread("t1", { type: "shape", shapeId: IMAGE, x: 1, y: 0, isPrecise: false }, { createdBy: "chat:x", meta: { ...agent.meta, number: 4 } }),
    message("m1", "t1", "Consider a wider crop", agent),
  ]);
  await expect(pin(page, "t1")).toHaveAttribute("data-unread", "");
  await expect(pin(page, "t1").locator("[data-comment-avatar='claude']")).toBeVisible();
  await expect(page.locator("[data-comment-tool-unread]")).toBeVisible();
  const imageBox = (await shapeOnScreen(page, IMAGE).boundingBox())!;
  const pinBox = (await pin(page, "t1").boundingBox())!;
  expect(Math.abs(pinBox.x - (imageBox.x + imageBox.width))).toBeLessThan(3);

  await pin(page, "t1").hover();
  await expect(page.locator("[data-comment-preview]")).toContainText("Claude");
  await expect(page.locator("[data-comment-preview]")).toContainText("Consider a wider crop");

  await commentMode(page);
  const row = sidebar(page).locator("[data-comment-row]");
  await expect(row).toContainText("#4");
  await expect(row).toContainText("Claude");
  await expect(row.locator("[data-comment-unread]")).toBeVisible();
  await row.click();
  await expect(popover(page)).toContainText("Claude");
  await expect(popover(page).locator("[data-comment-message-menu]")).toHaveCount(0);
  await expect(row.locator("[data-comment-unread]")).toHaveCount(0);
  await expect(page.locator("[data-comment-tool-unread]")).toHaveCount(0);
});

test("@Claude and @Codex show as mentions in a posted comment", async ({ page, engine }) => {
  await seeded(page, engine, [thread("t1", { type: "point", x: 200, y: -60 }), message("m1", "t1", "@Claude try a darker sky, or ask @codex")]);
  await pin(page, "t1").click();
  await expect(popover(page).locator("[data-comment-mention]")).toHaveText(["@Claude", "@codex"]);
});

test("you can edit and delete your own comment", async ({ page, engine }) => {
  const project = await seeded(page, engine, [thread("t1", { type: "point", x: 200, y: -60 }), message("m1", "t1", "First"), message("m2", "t1", "Typo hree")]);
  await pin(page, "t1").click();
  const second = popover(page).locator("[data-comment-message='comment:m2']");
  await second.hover();
  await second.getByRole("button", { name: "Comment actions" }).click();
  await page.getByRole("menuitem", { name: "Edit…" }).click();
  const field = second.locator("textarea");
  await field.fill("Typo here");
  await field.press("Enter");
  await expect(second).toContainText("Typo here (edited)");
  await waitForRoom(engine, project, (records) => comments(records).find((record) => record.id === "comment:m2")?.editedAt !== null);
  await second.hover();
  await second.getByRole("button", { name: "Comment actions" }).click();
  await page.getByRole("menuitem", { name: "Delete comment" }).click();
  await waitForRoom(engine, project, (records) => comments(records).length === 1);
});

test("dragging your pin onto an image anchors it there", async ({ page, engine }) => {
  const project = await seeded(page, engine, [thread("t1", { type: "point", x: 200, y: -60 }), message("m1", "t1", "Move me")]);
  const from = (await pin(page, "t1").boundingBox())!;
  const image = (await shapeOnScreen(page, IMAGE).boundingBox())!;
  await page.mouse.move(from.x + 16, from.y + 16);
  await page.mouse.down();
  await page.mouse.move(image.x + 100, image.y + 60, { steps: 8 });
  await page.mouse.up();
  const moved = await waitForRoom(engine, project, (records) => {
    const anchor = threads(records)[0]?.anchor;
    return anchor?.type === "shape" ? anchor : undefined;
  });
  expect(moved.shapeId).toBe(IMAGE);
  await expect(popover(page)).toHaveCount(0);
});

test("Esc drops a draft, then closes a thread, then leaves comment mode", async ({ page, engine }) => {
  const project = await seeded(page, engine, [thread("t1", { type: "point", x: 200, y: -60 }), message("m1", "t1", "Hello")]);
  await commentMode(page);
  const box = (await shapeOnScreen(page, IMAGE).boundingBox())!;
  await page.mouse.click(box.x + 60, box.y + 60);
  await page.locator("[data-comment-new] textarea").pressSequentially("never mind");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-comment-new]")).toHaveCount(0);
  await expect(page.locator("[data-comment-pending]")).toHaveCount(0);
  await pin(page, "t1").click();
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover(page)).toHaveCount(0);
  await expect(sidebar(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sidebar(page)).toHaveCount(0);
  expect(threads(await roomRecords(engine, project))).toHaveLength(1);
});

test("the watermark stays over the Comments panel", async ({ page, engine }) => {
  await seeded(page, engine, [
    ...Array.from({ length: 12 }, (_, i) => [thread(`t${i}`, { type: "point", x: 40 * i, y: -60 }), message(`m${i}`, `t${i}`, "A long note that fills the list so rows reach the bottom of the panel")]).flat(),
  ]);
  await commentMode(page);
  await expect(sidebar(page).locator("[data-comment-row]")).toHaveCount(12);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const watermark = document.querySelector(".tl-watermark_SEE-LICENSE");
        if (!watermark) return false;
        const box = watermark.getBoundingClientRect();
        return [0.2, 0.5, 0.8].every((fx) => document.elementFromPoint(box.x + box.width * fx, box.y + box.height / 2)?.closest(".tl-watermark_SEE-LICENSE") === watermark);
      }),
    )
    .toBe(true);
});
