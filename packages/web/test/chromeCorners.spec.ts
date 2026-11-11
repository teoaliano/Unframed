import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, putRecords } from "./media.ts";
import { expectSlot, inBothSchemes, resolvedColor, styleOf, tokenColor } from "./kit.ts";
import { platformOf } from "./platform.ts";

test("the top-left card holds the logo; Settings sits at the end opposite the window controls; the right hook stays in the page; there is no Help", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const os = await platformOf(page);
  const left = page.locator(".unframed-chrome-left");
  await expect(left.getByRole("img", { name: "Unframed" })).toBeVisible();
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await expect(settings).toHaveCount(1);
  // Spec 17: macOS and Linux keep Settings at the far right, Windows on the left, after the logo.
  expect(await page.locator(os.name === "win32" ? ".unframed-chrome-left" : ".unframed-chrome-right").getByRole("button", { name: "Settings", exact: true }).count()).toBe(1);
  // Spec 01: the shell's CSS expects exactly one right card.
  await expect(page.locator(".unframed-chrome-right")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Help" })).toHaveCount(0);
});

test("the bar runs the window's full width, 36 tall; the logo sits 22 px after the lights and 16 px before the first tab's divider", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const card = page.locator(".unframed-chrome-left");
  const box = (await card.boundingBox())!;
  // The bar is 36 px tall and its start region pads the logo 94 px in, past the lights.
  expect([box.x, box.y, box.height]).toEqual([0, 0, 36]);
  const body = (await page.locator("[data-slot='top-bar-body']").boundingBox())!;
  expect([body.x, body.y, body.width, body.height]).toEqual([0, 0, page.viewportSize()!.width, 36]);
  const logo = (await card.getByRole("img", { name: "Unframed" }).boundingBox())!;
  expect([logo.width, logo.height]).toEqual([18, 18]);
  expect(logo.x).toBe(94);
  const name = await page.locator("[data-project] span").first().evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().x;
  });
  const divider = (await page.locator("[data-slot=project-tabs-list]").boundingBox())!.x;
  expect(divider - (logo.x + logo.width)).toBe(16);
  expect(Math.round(name - divider)).toBe(1 + 8);
  const strip = (await page.getByTestId("tab-strip").boundingBox())!;
  expect(strip.height).toBe(36);
  expect(strip.y + strip.height / 2).toBe(18);
  const settings = (await page.getByRole("button", { name: "Settings", exact: true }).boundingBox())!;
  // Settings is a 24 px circle, 12 px from the window edge.
  expect([settings.width, settings.height]).toEqual([24, 24]);
  expect(settings.y + settings.height / 2).toBe(18);
  expect(page.viewportSize()!.width - (settings.x + settings.width)).toBe(12);
  const right = await page.locator(".unframed-chrome-right").evaluate((element) => ({ top: getComputedStyle(element).top, right: getComputedStyle(element).right }));
  expect(right).toEqual({ top: "0px", right: "0px" });
});

test("the shell's own inset on the top-left card replaces the bar's, so the logo sits 92 px in, not 92 plus the bar's", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await page.addStyleTag({ content: ".unframed-chrome-left { padding-left: 92px !important; }" });
  const logo = page.locator(".unframed-chrome-left").getByRole("img", { name: "Unframed" });
  await expect.poll(async () => (await logo.boundingBox())?.x).toBe(92);
});

test("on Windows the logo leads, then Settings, and the tabs stop clear of the caption buttons, whose corner takes no clicks", async ({ page, engine }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => "Win32" });
    Object.defineProperty(Navigator.prototype, "userAgentData", { configurable: true, get: () => ({ platform: "Windows" }) });
  });
  await openCanvas(page, engine);
  const width = page.viewportSize()!.width;
  const logo = (await page.locator(".unframed-chrome-left").getByRole("img", { name: "Unframed" }).boundingBox())!;
  expect(logo.x).toBe(12);
  const settings = (await page.locator(".unframed-chrome-left").getByRole("button", { name: "Settings", exact: true }).boundingBox())!;
  expect(settings.x).toBe(logo.x + logo.width + 12);
  expect((await page.locator("[data-slot=project-tabs-list]").boundingBox())!.x).toBe(settings.x + settings.width + 12);
  const strip = (await page.getByTestId("tab-strip").boundingBox())!;
  // Windows draws three 46 px caption buttons in the top-right corner.
  expect(width - (strip.x + strip.width)).toBeGreaterThanOrEqual(3 * 46 + 16);
  await page.addStyleTag({ content: ".unframed-chrome-right { top: 44px !important; }" });
  for (const point of [{ x: width - 69, y: 18 }, { x: width - 69, y: 62 }]) {
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-slot='top-bar-controls'], button") === null, point);
    expect(hit).toBe(true);
  }
});

test("the bar is one solid background with a bottom border; Settings is a circle with a kit ghost button and a kit tooltip", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const bar = page.locator("[data-slot=top-bar-body]");
  const cell = page.locator("[data-slot=top-bar-settings]");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await expectSlot(settings, "tooltip-trigger");
  await inBothSchemes(page, async () => {
    expect(await styleOf(bar, "background-color")).toBe(await resolvedColor(page, "var(--background)"));
    expect(await styleOf(bar, "border-bottom-width")).toBe("1px");
    expect(await styleOf(bar, "border-top-width")).toBe("0px");
    // A circle: the radius reaches half the 32 px diameter (the browser reports a fully rounded corner as a huge value).
    expect(parseFloat(await styleOf(cell, "border-top-left-radius"))).toBeGreaterThanOrEqual(16);
  });
});

test("the toolbar names text Prompt and frame Group, and the zoom controls sit bottom left", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await expect(page.getByTestId("tools.text")).toHaveAttribute("aria-label", /^Prompt/);
  const frame = page.locator("[data-testid='tools.frame'], [data-testid='tools.more.frame']");
  if ((await frame.count()) === 0) await page.getByTestId("tools.more-button").click();
  await expect(frame.first()).toHaveAttribute("aria-label", /^Group/);
  await page.keyboard.press("Escape");

  const zoom = page.getByTestId("minimap.zoom-menu-button");
  await expect(zoom).toBeVisible();
  const box = (await zoom.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeLessThan(viewport.width / 4);
  expect(box.y).toBeGreaterThan(viewport.height * 0.75);
  await zoom.click();
  for (const item of ["Zoom in", "Zoom out", "Zoom to fit"]) await expect(page.getByRole("menuitem", { name: new RegExp(`^${item}`) })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-testid='main-menu.button'], [data-testid='page-menu.button'], [data-testid='help-menu.button']")).toHaveCount(0);
  await expect(page.locator(".tlui-share-zone, .tlui-debug-panel")).toHaveCount(0);
});

test("the Design panel docks to the window's right edge from the bar's bottom border to the window's bottom, under the watermark", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.click(subject.x, subject.y);
  const panel = page.getByTestId("design-panel");
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect([box.y, box.width, box.x + box.width, box.y + box.height]).toEqual([36, 320, viewport.width, viewport.height]);
  expect(await styleOf(panel, "border-left-width")).toBe("1px");
  expect(await styleOf(panel, "border-top-left-radius")).toBe("0px");
  const toolbar = (await page.getByTestId("bottom-toolbar").boundingBox())!;
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(box.x);
  const watermarkOnTop = await page.evaluate(() => {
    const watermark = document.querySelector(".tl-watermark_SEE-LICENSE");
    if (!watermark) return false;
    const rect = watermark.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest(".tl-watermark_SEE-LICENSE") === watermark;
  });
  expect(watermarkOnTop).toBe(true);
});

test("the Design panel shows only while a drawing tool is on or the selection holds text, notes or drawings", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia("shape:still", "image", "180", { x: -400, y: 300 })]);
  const panel = page.getByTestId("design-panel");
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".tlui-style-panel")).toHaveCount(0);
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await page.mouse.click(subject.x, subject.y);
  await expect(panel).toBeVisible();
  const still = (await shapeOnScreen(page, "shape:still").boundingBox())!;
  await page.mouse.click(still.x + 12, still.y + 12);
  await expect(panel).toHaveCount(0);
  await page.getByTestId("tools.draw").click();
  await expect(panel).toBeVisible();
  await page.getByTestId("tools.select").click();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

const SHIPPED_SHELL_CSS = `.unframed-chrome-left { -webkit-app-region: drag; }
  .unframed-chrome-left > *:not(svg, [role="img"]) { -webkit-app-region: no-drag; }`;

const appRegions = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const region = (selector: string) => {
      const element = document.querySelector(selector);
      return element === null ? "missing" : getComputedStyle(element).getPropertyValue("-webkit-app-region");
    };
    return {
      bar: region("[data-slot=top-bar]"),
      lights: region("[data-slot=top-bar-controls]"),
      logo: region("[data-slot=top-bar-logo]"),
      start: region(".unframed-chrome-left"),
      tabs: region(".unframed-tabs"),
      end: region(".unframed-chrome-right"),
      tab: region("[role=tab]"),
      close: region("[data-close]"),
      allProjects: region("[data-testid=all-projects] button"),
      settings: region("[data-slot=top-bar-settings] button"),
    };
  });

test("the bar is a window drag region, with its tabs, close buttons, All projects and Settings left clickable, also under the shell's own chrome CSS", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const expected = {
    bar: "drag",
    lights: "drag",
    logo: "drag",
    start: "drag",
    tabs: "drag",
    end: "drag",
    tab: "no-drag",
    close: "no-drag",
    allProjects: "no-drag",
    settings: "no-drag",
  };
  expect(await appRegions(page)).toEqual(expected);
  await page.addStyleTag({ content: SHIPPED_SHELL_CSS });
  expect(await appRegions(page)).toEqual(expected);
});

const regionsAtPoints = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const at = (x: number, y: number) => {
      let found = "none";
      for (const element of document.querySelectorAll("*")) {
        const value = getComputedStyle(element).getPropertyValue("-webkit-app-region");
        if (value !== "drag" && value !== "no-drag") continue;
        const box = element.getBoundingClientRect();
        if (x >= box.left && x < box.right && y >= box.top && y < box.bottom) found = value;
      }
      return found;
    };
    const centre = (selector: string) => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return at(box.left + box.width / 2, box.top + box.height / 2);
    };
    const plus = document.querySelector("[data-testid=all-projects] button")!.getBoundingClientRect();
    const end = document.querySelector(".unframed-chrome-right")!.getBoundingClientRect();
    return {
      lights: at(40, 18),
      logo: centre("[data-slot=top-bar-logo]"),
      tab: centre("[role=tab]"),
      close: centre("[data-close]"),
      allProjects: centre("[data-testid=all-projects] button"),
      empty: at((plus.right + end.left) / 2, 18),
      settings: centre("[data-slot=top-bar-settings] button"),
    };
  });

test("in document order, as Electron resolves overlapping regions, nothing declared after the tabs makes them drag again", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const expected = { lights: "drag", logo: "drag", tab: "no-drag", close: "no-drag", allProjects: "no-drag", empty: "drag", settings: "no-drag" };
  expect(await regionsAtPoints(page)).toEqual(expected);
  await page.addStyleTag({ content: SHIPPED_SHELL_CSS });
  expect(await regionsAtPoints(page)).toEqual(expected);
});
