import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

const OPEN_MENU = { state: "the menu open", steps: [{ action: "click", target: { role: "button", name: "Open menu" } }] };

test("an app that boots for seven seconds, busy on the network, still reaches its state", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/boot?ms=7000", w: 640, h: 480, ...OPEN_MENU } }]);
    await clickShape(page, first.id);
    const frame = page.frameLocator(`[data-screen-of="${first.id}"] iframe[data-screen-frame]`);
    await expect(frame.locator("#boot")).toHaveText("Booted", { timeout: 30_000 });
    await expect(frame.getByRole("menuitem", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("screen-state-failed")).toHaveCount(0);
  });
});

const hits = async (page: Page, key: string) => {
  const frame = page.frames().find((item) => item.url().includes(`key=${key}`));
  if (frame === undefined) throw new Error(`no frame for ${key}`);
  return frame.evaluate(async (key) => (await fetch(`/__fake/hits?key=${key}`)).json() as Promise<number>, key);
};

test("a state that fails once is tried again from a fresh load, and shows no failure when that works", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await page.evaluate(() => {
      (window as any).__failed = false;
      new MutationObserver(() => {
        if (document.querySelector("[data-testid=screen-state-failed]") !== null) (window as any).__failed = true;
      }).observe(document.body, { subtree: true, childList: true });
    });
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/flaky?key=once&fails=1", w: 640, h: 480, ...OPEN_MENU } }]);
    await clickShape(page, first.id);
    const frame = page.frameLocator(`[data-screen-of="${first.id}"] iframe[data-screen-frame]`);
    await expect(frame.getByRole("menuitem", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator("#load")).toHaveText("Load 2");
    expect(await page.evaluate(() => (window as any).__failed)).toBe(false);
  });
});

test("a state that keeps failing shows Couldn't reach this state after one retry", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/flaky?key=always&fails=99", w: 640, h: 480, ...OPEN_MENU } }]);
    await clickShape(page, first.id);
    await expect(page.getByTestId("screen-state-failed")).toBeVisible({ timeout: 30_000 });
    const failedAt = await hits(page, "always");
    await page.waitForTimeout(1000);
    expect(await hits(page, "always")).toBe(failedAt);
  });
});

test("with ?fps=1 the meter counts Screens by tier, and replays, retries and failed states", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await page.goto(`${engine.origin}/?fps=1`);
    const screen = page.locator(`[data-canvas-project="${project}"] [data-testid=screen]`);
    await expect(screen).toHaveAttribute("data-picture", /^[a-f0-9]{40}$/, { timeout: 30_000 });
    await expect(screen).toHaveAttribute("data-level", "page");
    await expect(screen.locator("[data-testid=screen-page-copy]")).toHaveAttribute("data-built", "true", { timeout: 10_000 });
    const line = page.locator("[data-fps-screens]");
    await expect(line).toHaveText("screens: live 0 · warming 0 · parked 0 · snapshot 1 · picture 0 · replays 0 · retries 0 · failed 0");
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/flaky?key=meter&fails=99", w: 640, h: 480, ...OPEN_MENU } }]);
    await clickShape(page, first.id);
    await expect(page.getByTestId("screen-state-failed")).toBeVisible({ timeout: 30_000 });
    await expect(line).toHaveText("screens: live 1 · warming 0 · parked 0 · snapshot 0 · picture 0 · replays 2 · retries 1 · failed 1");
    expect(await page.evaluate(() => (window as any).__fps.screens())).toEqual({ live: 1, warming: 0, parked: 0, snapshot: 0, picture: 0, replays: 2, retries: 1, failed: 1 });
  });
});
