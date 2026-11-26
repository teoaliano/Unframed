import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

const IDS = ["shape:tier-a", "shape:tier-b", "shape:tier-c"];

const screenOf = (page: Page, id: string) => page.locator(`[data-shape-id="${id}"] [data-testid=screen]`);

const putBusyScreens = async (page: Page, engine: Parameters<Parameters<typeof withRepository>[2]>[0], project: string) => {
  const [first] = await screenShapes(engine, project);
  await putShapes(engine, project, [
    { ...first, x: -2000, y: -2000 },
    ...IDS.map((id, index) => ({ ...first, id, index: `a${index + 5}`, x: index * 440, y: 0, props: { ...first.props, route: `/busy?n=${index}`, w: 390, h: 300 } })),
  ]);
  await page.mouse.click(5, 300);
  await page.keyboard.press("Shift+1");
  for (const id of IDS) await expect(screenOf(page, id)).toHaveAttribute("data-picture", /^[a-f0-9]{40}$/, { timeout: 60_000 });
};

const openFrames = (page: Page) => page.locator("iframe[data-screen-frame]:not([data-parked])").count();

test("only the selected Screen runs live; the last ones stay parked, come back with no reload, and Escape parks with a fresh capture", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(0);
    const [a, b, c] = IDS as [string, string, string];

    await clickShape(page, a);
    await expect(screenOf(page, a)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await expect(screenOf(page, a)).toHaveAttribute("data-tier", "live");
    await page.frameLocator(`[data-shape-id="${a}"] iframe[data-screen-frame]`).locator("body").evaluate(() => ((window as any).__kept = true));

    await clickShape(page, b);
    await expect(screenOf(page, b)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await expect(screenOf(page, a)).toHaveAttribute("data-tier", "parked");
    await expect(screenOf(page, a).locator("iframe[data-screen-frame]")).toHaveAttribute("data-parked", "true");
    expect(await openFrames(page)).toBe(1);

    await clickShape(page, c);
    await expect(screenOf(page, c)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    expect(await openFrames(page)).toBe(1);
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(3);

    await clickShape(page, a);
    await expect(screenOf(page, a)).toHaveAttribute("data-painted", "true", { timeout: 2000 });
    expect(await page.frameLocator(`[data-shape-id="${a}"] iframe[data-screen-frame]`).locator("body").evaluate(() => (window as any).__kept === true)).toBe(true);
    expect(await openFrames(page)).toBe(1);

    const before = await screenOf(page, a).getAttribute("data-picture");
    await page.frameLocator(`[data-shape-id="${a}"] iframe[data-screen-frame]`).locator("body").evaluate(() => {
      document.getElementById("bar")!.textContent = "Changed in the live Screen";
    });
    await page.keyboard.press("Escape");
    await expect(screenOf(page, a)).toHaveAttribute("data-tier", "parked");
    await expect(screenOf(page, a)).not.toHaveAttribute("data-painted", "true");
    await expect(screenOf(page, a)).not.toHaveAttribute("data-picture", before!, { timeout: 30_000 });
    expect(await openFrames(page)).toBe(0);
  });
});

test("a duplicated Screen shows the original's picture at once", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    const [a] = IDS as [string];
    const picture = await screenOf(page, a).getAttribute("data-picture");
    await clickShape(page, a);
    const before = await page.locator("[data-testid=screen]").count();
    await page.keyboard.press("ControlOrMeta+d");
    await expect(page.locator("[data-testid=screen]")).toHaveCount(before + 1, { timeout: 2000 });
    const shown = await page.evaluate(
      ({ picture, original }) =>
        [...document.querySelectorAll<HTMLElement>(`[data-testid=screen][data-picture="${picture}"]`)]
          .filter((element) => element.closest("[data-shape-id]")?.getAttribute("data-shape-id") !== original)
          .map((element) => element.querySelector<HTMLImageElement>("img[data-testid=screen-snapshot]")?.src ?? ""),
      { picture, original: a },
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain(picture);
  });
});

test("switching back to a board shows every visible Screen's picture in its first frame", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    await page.waitForTimeout(500);
    await page.locator("[role=tab][data-project='default']").click();
    await expect(page.locator(`[data-canvas-project="${project}"]`)).toHaveCount(0);
    await page.evaluate(() => {
      const seen: Array<{ screens: number; pictured: number; placeholders: number }> = [];
      const check = () => {
        const screens = [...document.querySelectorAll<HTMLElement>("[data-testid=screen][data-picture]")];
        if (screens.length > 0) {
          const pictured = screens.filter((screen) => screen.querySelector("img[data-testid=screen-snapshot]") !== null).length;
          seen.push({ screens: screens.length, pictured, placeholders: document.querySelectorAll("[data-testid=screen-placeholder]").length });
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      (window as any).__firstFrame = () => seen[0];
    });
    await page.locator(`[role=tab][data-project='${project}']`).click();
    await expect.poll(() => page.evaluate(() => (window as any).__firstFrame())).toBeTruthy();
    const first = await page.evaluate(() => (window as any).__firstFrame());
    expect(first.pictured).toBe(first.screens);
    expect(first.placeholders).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLImageElement>("[data-testid=screen][data-picture] img[data-testid=screen-snapshot]")].every((image) => image.complete && image.naturalWidth > 0),
        ),
      )
      .toBe(true);
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(0);
  });
});

test("a Screen large on screen shows a static copy of its page in a closed shadow root, and a small one an image", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    const [a] = IDS as [string];
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Shift+0");
    await expect(screenOf(page, a)).toHaveAttribute("data-level", "page", { timeout: 10_000 });
    const copy = screenOf(page, a).locator("[data-testid=screen-page-copy]");
    await expect(copy).toHaveAttribute("data-built", "true", { timeout: 10_000 });
    await expect(screenOf(page, a)).toHaveAttribute("data-tier", "snapshot");
    expect(await copy.evaluate((element) => element.shadowRoot)).toBeNull();
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(0);
    for (let step = 0; step < 14; step++) {
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, 60);
      await page.keyboard.up("Control");
      await page.waitForTimeout(20);
    }
    await expect(screenOf(page, a)).toHaveAttribute("data-level", /tiny|small/, { timeout: 10_000 });
    await expect(screenOf(page, a).locator("[data-testid=screen-page-copy]")).toHaveCount(0);
    await expect(screenOf(page, a).locator("img[data-testid=screen-snapshot]")).toHaveAttribute("src", /\.w(128|384)\.png$/);
  });
});
