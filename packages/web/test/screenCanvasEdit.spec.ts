import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { REACT_APP, positionOf, prepareReactApp } from "../../engine/test/reactFixture.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const SHOWN_FRAME = '[data-screen-of][style*="visibility: visible"] iframe[data-screen-frame]';
const app = (page: Page) => page.frameLocator(SHOWN_FRAME);
const overlay = (page: Page) => page.getByTestId("design-overlay");
const hoverChip = (page: Page) => page.getByTestId("design-hover-chip");
const badge = (page: Page) => page.getByTestId("design-size-badge");
const panel = (page: Page) => page.getByTestId("screen-design-panel");

const openReact = async (page: Page, engine: TestEngine, project: string) => {
  const [first] = await screenShapes(engine, project);
  await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/react", w: 960, h: 600 } }]);
  await expect(page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`)).toHaveAttribute("data-route", "/react");
  await clickShape(page, first.id);
  await expect(page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
  await expect(app(page).getByRole("heading", { name: "Agent" })).toBeVisible({ timeout: 30_000 });
  return first.id as string;
};

const pointIn = async (page: Page, selector: string, at: { readonly x: number; readonly y: number } = { x: 0.5, y: 0.5 }) => {
  const outer = await page.locator(SHOWN_FRAME).evaluate((frame) => {
    const rect = frame.getBoundingClientRect();
    return { x: rect.x, y: rect.y, scale: rect.width / (frame as HTMLElement).offsetWidth };
  });
  const inner = await app(page)
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
  return { x: outer.x + (inner.x + inner.w * at.x) * outer.scale, y: outer.y + (inner.y + inner.h * at.y) * outer.scale };
};

const enterOn = async (page: Page, selector: string) => {
  const at = await pointIn(page, selector);
  await expect(async () => {
    await page.mouse.dblclick(at.x, at.y);
    await expect(overlay(page)).toBeAttached({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator(SHOWN_FRAME)).toHaveAttribute("data-interactive", "true", { timeout: 10_000 });
};

test("a double-click on a selected Screen enters design mode: hover shows a chip, a click selects with corner handles, a size badge and the parent dashed; Escape clears it and a click on empty canvas leaves", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      const id = await openReact(page, engine, project);
      await enterOn(page, "header");
      await expect(panel(page)).toBeVisible();
      await expect(overlay(page).locator('[data-design-outline="selected"]')).toHaveCount(1, { timeout: 10_000 });
      await expect(page.getByTestId("screen-design-title")).toHaveText("Header");

      const second = await pointIn(page, "li:nth-child(2) h3");
      await page.mouse.move(second.x, second.y);
      await expect(hoverChip(page)).toHaveText(/^Card \d+×\d+$/);

      await page.mouse.click(second.x, second.y);
      await expect(page.getByTestId("screen-design-title")).toHaveText("Card");
      await expect(overlay(page).locator("[data-design-corner]")).toHaveCount(4);
      await expect(badge(page)).toHaveText(/^\d+(\.\d)? × \d+(\.\d)?$/);
      await expect(overlay(page).locator('[data-design-outline="parent"]')).toHaveCount(1);

      await page.keyboard.down("Alt");
      const header = await pointIn(page, "header h2");
      await page.mouse.move(header.x, header.y);
      await expect(page.getByTestId("design-distance-chip")).toHaveText(/^\d+(\.\d)?$/);
      await page.keyboard.up("Alt");
      await expect(page.getByTestId("design-distance-chip")).toHaveCount(0);

      const first = await pointIn(page, "li:nth-child(1) h3");

      await page.keyboard.down("Shift");
      await page.mouse.click(first.x, first.y);
      await page.keyboard.up("Shift");
      await expect(overlay(page).locator('[data-design-outline="selected"]')).toHaveCount(2);
      await expect(overlay(page).locator('[data-design-outline="union"]')).toHaveCount(1);
      await expect(overlay(page).locator("[data-design-corner]")).toHaveCount(4);
      await expect(page.getByTestId("screen-design-title")).toHaveText("2 selected");

      await page.keyboard.press("Escape");
      await expect(overlay(page).locator('[data-design-outline="selected"]')).toHaveCount(0);
      await expect(overlay(page)).toBeAttached();
      expect(await screenShapes(engine, project)).toHaveLength(1);

      const screen = (await page.locator(`[data-shape-id="${id}"]`).boundingBox())!;
      await page.mouse.click(screen.x / 2, screen.y + screen.height / 2);
      await expect(overlay(page)).toHaveCount(0);
      await expect(panel(page)).toHaveCount(0);
      expect((await screenShapes(engine, project)).map((shape) => shape.id)).toEqual([id]);
    },
    prepareReactApp,
  );
});

const centreOf = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const frameScale = (page: Page) =>
  page.locator(SHOWN_FRAME).evaluate((frame) => frame.getBoundingClientRect().width / (frame as HTMLElement).offsetWidth);

const dragBy = async (page: Page, from: { readonly x: number; readonly y: number }, by: { readonly x: number; readonly y: number }, during?: () => Promise<void>) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(from.x + (by.x * step) / 6, from.y + (by.y * step) / 6);
  await during?.();
  await page.mouse.up();
};

const computed = (page: Page, selector: string, property: string) => app(page).locator(selector).first().evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

const openDrafts = async (page: Page) => {
  await page.getByTestId("design-drafts-count").click();
  return page.getByRole("list", { name: "Changes" }).locator("[data-draft-row]");
};

test("dragging a padding bar and a gap bar sets them one to one and two to one, snapped to the scale with a live chip, as drafts the page shows", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await enterOn(page, "header h2");
      await expect(page.getByTestId("screen-design-title")).toHaveText("Header");
      const scale = await frameScale(page);

      await expect(overlay(page).locator('[data-design-padding="left"]')).toBeVisible();
      await expect(overlay(page).locator('[data-design-padding="top"]')).toHaveCount(0);
      await dragBy(page, await centreOf(page, '[data-design-padding="left"]'), { x: 6 * scale, y: 0 }, async () => {
        await expect(page.getByTestId("design-drag-chip")).toHaveText("20 · pl-5");
      });
      await expect.poll(() => computed(page, "header", "padding-left")).toBe("20px");

      await page.keyboard.press("Shift+Enter");
      await expect(page.getByTestId("screen-design-title")).toHaveText("App");
      await expect(overlay(page).locator("[data-design-gap]")).toHaveCount(2);
      await dragBy(page, await centreOf(page, "[data-design-gap]"), { x: 6 * scale, y: 0 }, async () => {
        await expect(page.getByTestId("design-drag-chip")).toHaveText("28 · gap-7");
        await expect(overlay(page).locator("[data-design-hatch]")).toHaveCount(2);
      });
      await expect.poll(() => computed(page, "main", "column-gap")).toBe("28px");

      await expect(page.getByTestId("design-drafts-count")).toHaveAccessibleName("2 changes");
      const rows = await openDrafts(page);
      await expect(rows.getByTestId("draft-line")).toHaveText(["Padding left 14 → 20 pl-5", "Gap 16 → 28 gap-7"]);
    },
    prepareReactApp,
  );
});

test("edge and corner handles resize with a live badge, the radius circle near a corner rounds it, and dragging an element in a flex row reorders it", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await enterOn(page, "li:nth-child(2) h3");
      await expect(page.getByTestId("screen-design-title")).toHaveText("Card");
      const scale = await frameScale(page);
      const before = Number.parseFloat(await computed(page, "li:nth-child(2)", "width"));

      await expect(overlay(page).locator('[data-design-edge="right"]')).toHaveClass(/cursor-ew-resize/);
      await expect(overlay(page).locator('[data-design-resize="se"]')).toHaveClass(/cursor-nwse-resize/);
      await dragBy(page, await centreOf(page, '[data-design-edge="right"]'), { x: -30 * scale, y: 0 }, async () => {
        await expect(badge(page)).toHaveText(/ × /);
      });
      await expect.poll(async () => Number.parseFloat(await computed(page, "li:nth-child(2)", "width"))).toBeLessThan(before - 25);

      const corner = await pointIn(page, "li:nth-child(2)", { x: 1, y: 1 });
      await page.mouse.move(corner.x - 16 * scale, corner.y - 16 * scale);
      await expect(overlay(page).locator('[data-design-radius="se"]')).toBeVisible();
      await dragBy(page, await centreOf(page, '[data-design-radius="se"]'), { x: -12 * scale, y: -12 * scale }, async () => {
        await expect(page.getByTestId("design-drag-chip")).toHaveText("Radius 20");
      });
      await expect.poll(() => computed(page, "li:nth-child(2)", "border-top-left-radius")).toBe("20px");

      await page.keyboard.press("Escape");
      const header = await pointIn(page, "header h2");
      await page.mouse.click(header.x, header.y);
      await expect(page.getByTestId("screen-design-title")).toHaveText("Header");
      const list = await pointIn(page, "ul", { x: 0.8, y: 0.2 });
      await dragBy(page, header, { x: list.x - header.x, y: list.y - header.y });
      await expect.poll(async () => (await app(page).locator("header").boundingBox())!.x > (await app(page).locator("ul").boundingBox())!.x).toBe(true);
      const rows = await openDrafts(page);
      await expect(rows.getByTestId("draft-line")).toContainText(["Moved after List"]);
    },
    prepareReactApp,
  );
});

const title = (page: Page) => page.getByTestId("screen-design-title");

test("keys reorder, duplicate, hide, wrap, delete, set opacity and bold, undo and redo each step, and Delete never deletes the Screen", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await enterOn(page, "header h2");
      await expect(title(page)).toHaveText("Header");

      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await app(page).locator("header").boundingBox())!.x > (await app(page).locator("ul").boundingBox())!.x).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(async () => (await app(page).locator("header").boundingBox())!.x < (await app(page).locator("ul").boundingBox())!.x).toBe(true);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect.poll(async () => (await app(page).locator("header").boundingBox())!.x > (await app(page).locator("ul").boundingBox())!.x).toBe(true);

      const second = await pointIn(page, "li:nth-child(2) p");
      await page.mouse.click(second.x, second.y);
      await expect(title(page)).toHaveText("Card");
      await page.keyboard.press("5");
      await expect.poll(() => computed(page, "li:nth-child(2)", "opacity")).toBe("0.5");
      await page.keyboard.press("ControlOrMeta+d");
      await expect(app(page).locator("li")).toHaveCount(4);
      await page.keyboard.press("ControlOrMeta+Shift+h");
      await page.keyboard.press("ControlOrMeta+g");
      await page.keyboard.press("Delete");
      await expect(title(page)).toHaveText("Design");
      expect(await screenShapes(engine, project)).toHaveLength(1);

      await page.keyboard.down("ControlOrMeta");
      const body = await pointIn(page, "li:nth-child(1) p");
      await page.mouse.click(body.x, body.y);
      await page.keyboard.up("ControlOrMeta");
      await expect(title(page)).toHaveText("Text");
      await page.keyboard.press("ControlOrMeta+b");
      await expect.poll(() => computed(page, "li:nth-child(1) p", "font-weight")).toBe("700");

      await title(page).click();
      await page.keyboard.press("Backspace");
      await expect(title(page)).toHaveText("Design");
      await page.keyboard.press("Delete");
      expect(await screenShapes(engine, project)).toHaveLength(1);
      await expect(overlay(page)).toBeAttached();

      const rows = await openDrafts(page);
      await expect(rows.getByTestId("draft-line")).toHaveText([
        "Moved after List",
        "Opacity 100% → 50% opacity-50",
        "Duplicated (the copy right after it)",
        "Hidden",
        "Wrapped it in a new frame (flexbox, column)",
        "Deleted",
        "Weight Regular → Bold font-bold",
        "Deleted",
      ]);
    },
    prepareReactApp,
  );
});

test("a double-click on a word of a selected text edits it in place and Escape commits it as a draft", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await enterOn(page, "header h2");
      await page.keyboard.down("ControlOrMeta");
      const word = await pointIn(page, "li:nth-child(2) h3", { x: 0.2, y: 0.5 });
      await page.mouse.click(word.x, word.y);
      await page.keyboard.up("ControlOrMeta");
      await expect(title(page)).toHaveText("Heading");
      await page.mouse.dblclick(word.x, word.y);
      await expect(app(page).locator("li:nth-child(2) h3")).toHaveAttribute("contenteditable", "plaintext-only");
      await page.keyboard.type("Fourth");
      await page.keyboard.press("Escape");
      await expect(app(page).locator("li:nth-child(2) h3")).not.toHaveAttribute("contenteditable");
      await expect(app(page).locator("li:nth-child(2) h3")).toHaveText("Fourth");
      await expect(title(page)).toHaveText("Heading");
      const rows = await openDrafts(page);
      await expect(rows.getByTestId("draft-line")).toHaveText(["Text “Second” → “Fourth”"]);
    },
    prepareReactApp,
  );
});

test("the drafts bar lists the changes, pins them with Show all, compares by swipe, discards all with undo, and Apply writes a padding drag", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await enterOn(page, "header h2");
      const scale = await frameScale(page);
      await dragBy(page, await centreOf(page, '[data-design-padding="left"]'), { x: 6 * scale, y: 0 });
      const second = await pointIn(page, "li:nth-child(2) p");
      await page.mouse.click(second.x, second.y);
      await page.keyboard.press("5");
      await expect(page.getByTestId("design-drafts-count")).toHaveAccessibleName("2 changes");

      const rows = await openDrafts(page);
      await expect(rows.getByTestId("draft-layer")).toHaveText(["Header", "Card"]);
      await page.getByRole("button", { name: "Show all" }).click();
      await expect(page.locator("[data-design-pin]")).toHaveCount(2);
      await rows.first().getByTestId("draft-layer").getByRole("button").click();
      await expect(title(page)).toHaveText("Header");
      await page.keyboard.press("Escape");

      const compare = page.getByRole("button", { name: "Compare" });
      if (await compare.isEnabled()) {
        await compare.click();
        await expect(page.getByTestId("design-swipe")).toBeVisible();
        await compare.click();
        await expect(page.getByTestId("design-swipe")).toHaveCount(0);
      }

      await page.getByRole("button", { name: "Discard all" }).click();
      await expect(page.getByTestId("design-drafts")).toHaveCount(0);
      await expect.poll(() => computed(page, "header", "padding-left")).toBe("14px");
      await page.keyboard.press("ControlOrMeta+z");
      await expect(page.getByTestId("design-drafts-count")).toHaveAccessibleName("2 changes");
      await expect.poll(() => computed(page, "header", "padding-left")).toBe("20px");

      const rpc = await engine.rpc();
      const worktree = (await rpc.call("instances.list", { project })).instances[0]!.worktree;
      await rpc.close();
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await page.getByTestId("design-drafts-count").click();
      await expect(page.getByRole("list", { name: "Changes" }).locator("[data-draft-row]").first().getByTestId("draft-state")).toHaveText("Took", { timeout: 30_000 });
      await expect.poll(() => readFile(join(worktree, "src", "App.jsx"), "utf8"), { timeout: 10_000 }).toContain("pl-5 pr-2");
    },
    prepareReactApp,
  );
});

test("drafts survive leaving design mode: the Screen counts them, and entering it again shows them on the page and in the bar", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      const id = await openReact(page, engine, project);
      await enterOn(page, "header h2");
      const scale = await frameScale(page);
      await dragBy(page, await centreOf(page, '[data-design-padding="left"]'), { x: 6 * scale, y: 0 });
      await expect(page.getByTestId("design-drafts-count")).toHaveAccessibleName("1 change");

      const screen = (await page.locator(`[data-shape-id="${id}"]`).boundingBox())!;
      await page.mouse.click(screen.x / 2, screen.y + screen.height / 2);
      await expect(overlay(page)).toHaveCount(0);
      await expect(page.locator(`[data-shape-id="${id}"]`).getByTestId("screen-drafts-badge")).toHaveAccessibleName("1 change not applied");

      await clickShape(page, id);
      await enterOn(page, "header h2");
      await expect(page.getByTestId("design-drafts-count")).toHaveAccessibleName("1 change");
      await expect.poll(() => computed(page, "header", "padding-left"), { timeout: 10_000 }).toBe("20px");
      await openDrafts(page);
      await expect(page.getByRole("list", { name: "Changes" }).locator("[data-draft-row]")).toHaveCount(1);
    },
    prepareReactApp,
  );
});

test("a right-click offers Select layer with the ancestor chain and each one's file and line, and the Design panel shows the selection's source", async ({ page }) => {
  await withRepository(
    page,
    {},
    async (engine, project) => {
      await openReact(page, engine, project);
      await enterOn(page, "header h2");
      const at = positionOf(REACT_APP, "<header");
      await panel(page).getByRole("button", { name: `Code: App.jsx:${at.line}` }).click();
      await expect(page.getByTestId("screen-source-file")).toHaveText(`src/App.jsx:${at.line}–${at.line + 2}`);
      await page.keyboard.press("Escape");

      const heading = await pointIn(page, "li:nth-child(2) h3");
      await page.mouse.click(heading.x, heading.y, { button: "right" });
      const menu = page.getByRole("menu", { name: "Layer actions" });
      await expect(menu).toBeVisible();
      await menu.getByRole("menuitem", { name: "Select layer" }).hover();
      const layers = page.getByRole("menu", { name: "Select layer" });
      await expect(layers.getByRole("menuitem").first()).toContainText("Heading · in Card");
      await expect(layers.getByRole("menuitem").first()).toContainText("Card.jsx:4");
      await expect(layers.getByRole("menuitem").nth(1)).toContainText("Card.jsx:3");
      await layers.getByRole("menuitem").nth(1).click();
      await expect(title(page)).toHaveText("Card");
      await panel(page).getByRole("button", { name: "Code: Card.jsx:3" }).click();
      await expect(page.getByTestId("screen-source-file")).toContainText("src/Card.jsx:3");
    },
    prepareReactApp,
  );
});
