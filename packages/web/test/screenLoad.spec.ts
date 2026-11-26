import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";

const watchLoads = (page: Page) =>
  page.evaluate(() => {
    const seen: string[] = [];
    let most = 0;
    let queued = false;
    const check = () => {
      const screens = [...document.querySelectorAll<HTMLElement>("[data-testid=screen]")];
      for (const screen of screens) {
        const id = screen.closest("[data-shape-id]")?.getAttribute("data-shape-id") ?? "";
        if (screen.querySelector("iframe[data-screen-frame]") !== null && !seen.includes(id)) seen.push(id);
        if (screen.getAttribute("data-queued") === "true") queued = true;
      }
      most = Math.max(most, screens.filter((screen) => screen.querySelector("iframe[data-screen-frame]") !== null && screen.getAttribute("data-painted") !== "true").length);
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-painted", "data-queued"] });
    (window as any).__loads = () => ({ seen, most, queued });
  });

const loads = (page: Page) => page.evaluate(() => (window as any).__loads() as { seen: string[]; most: number; queued: boolean });

const byDistance = (page: Page, ids: string[]) =>
  page.evaluate((ids) => {
    const canvas = document.querySelector("[data-canvas-project] .tl-canvas")!.getBoundingClientRect();
    const centre = { x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height / 2 };
    const distance = (id: string) => {
      const box = document.querySelector(`[data-shape-id="${id}"]`)!.getBoundingClientRect();
      return Math.hypot(box.left + box.width / 2 - centre.x, box.top + box.height / 2 - centre.y);
    };
    return [...ids].sort((a, b) => distance(a) - distance(b));
  }, ids);

const SLOW = ["shape:slow-a", "shape:slow-b", "shape:slow-c"];

const putSlowScreens = async (page: Page, engine: Parameters<Parameters<typeof withRepository>[2]>[0], project: string) => {
  const [first] = await screenShapes(engine, project);
  await expect(page.locator(`[data-shape-id="${first.id}"] [data-testid=screen]`)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
  await watchLoads(page);
  await putShapes(
    engine,
    project,
    SLOW.map((id, index) => ({ ...first, id, index: `a${index + 5}`, x: first.x + [880, 0, 440][index]!, y: first.y + 20, props: { ...first.props, route: `/slow?ms=1500&n=${index}`, w: 390, h: 300 } })),
  );
  await expect(page.locator("[data-testid=screen][data-queued=true]").first()).toBeVisible({ timeout: 15_000 });
};

const allPainted = async (page: Page) => {
  for (const id of SLOW) await expect(page.locator(`[data-shape-id="${id}"] [data-testid=screen]`)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
};

test("Screens that go live together load one at a time, nearest to the viewport centre first, waiting ones queued", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    await putSlowScreens(page, engine, project);
    await allPainted(page);
    const { seen, most, queued } = await loads(page);
    expect(most).toBe(1);
    expect(queued).toBe(true);
    expect(seen.filter((id) => SLOW.includes(id))).toEqual(await byDistance(page, SLOW));
  });
});

test("a Screen selected while others wait loads next", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    await putSlowScreens(page, engine, project);
    const farthest = (await byDistance(page, SLOW))[2]!;
    await clickShape(page, farthest);
    await allPainted(page);
    const { seen, most } = await loads(page);
    expect(most).toBe(1);
    expect(seen.filter((id) => SLOW.includes(id))[1]).toBe(farthest);
  });
});

const OPEN_MENU = { state: "the menu open", steps: [{ action: "click", target: { role: "button", name: "Open menu" } }] };

test("an app that boots for seven seconds, busy on the network, still reaches its state", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/boot?ms=7000", w: 640, h: 480, ...OPEN_MENU } }]);
    const frame = page.frameLocator(`[data-shape-id="${first.id}"] iframe[data-screen-frame]`);
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
    const frame = page.frameLocator(`[data-shape-id="${first.id}"] iframe[data-screen-frame]`);
    await expect(frame.getByRole("menuitem", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator("#load")).toHaveText("Load 2");
    expect(await page.evaluate(() => (window as any).__failed)).toBe(false);
  });
});

test("a state that keeps failing shows Couldn't reach this state after one retry", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const [first] = await screenShapes(engine, project);
    await putShapes(engine, project, [{ ...first, props: { ...first.props, route: "/flaky?key=always&fails=99", w: 640, h: 480, ...OPEN_MENU } }]);
    await expect(page.getByTestId("screen-state-failed")).toBeVisible({ timeout: 30_000 });
    expect(await hits(page, "always")).toBe(2);
    await page.waitForTimeout(1000);
    expect(await hits(page, "always")).toBe(2);
  });
});
