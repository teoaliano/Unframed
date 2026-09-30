import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { centre, shapeOnScreen } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { filledArtifact } from "./artifacts.ts";

const frames = (page: Page) => page.locator(".tl-shape iframe[data-artifact-frame]");

/** Opens the app the way the desktop shell loads it: served by the engine, on 127.0.0.1. */
const openHosted = async (page: Page, engine: TestEngine) => {
  await page.goto(`http://127.0.0.1:${engine.port}/`);
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
};

/** Six small pages in a row, fit to view. */
const sixPages = async (page: Page, engine: TestEngine) => {
  for (let index = 0; index < 6; index++) {
    await filledArtifact(engine, {
      id: `shape:p${index}`,
      kind: "page",
      ref: String(150 + index),
      at: { x: -1400 + index * 260, y: 700 },
      size: { w: 220, h: 140 },
      title: `Page ${index}`,
      html: `<h1>Page ${index}</h1>`,
    });
  }
  await expect(shapeOnScreen(page, "shape:p5")).toHaveCount(1);
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);
};

test("artifact frames load under the other loopback name, and in the hosted shape each runs in a process of its own", async ({ page, engine }) => {
  await openHosted(page, engine);
  await sixPages(page, engine);
  await clickShape(page, "shape:p0");
  await clickShape(page, "shape:p1", ["Shift"]);
  await expect(frames(page)).toHaveCount(2);
  for (const src of await frames(page).evaluateAll((items) => items.map((item) => (item as HTMLIFrameElement).src))) {
    expect(new URL(src).host).toBe(`localhost:${engine.previewPort}`);
  }
  // Out-of-process frames are targets of their own in the browser.
  const session = await page.context().newCDPSession(page);
  await expect
    .poll(async () => {
      const { targetInfos } = (await session.send("Target.getTargets")) as { targetInfos: Array<{ type: string; url: string }> };
      return targetInfos.filter((target) => target.type === "iframe" && target.url.startsWith(`http://localhost:${engine.previewPort}/p/`)).length;
    })
    .toBe(2);
  await session.detach();

  // Opened on localhost, the app frames artifacts from 127.0.0.1 instead.
  await page.goto(engine.origin);
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(shapeOnScreen(page, "shape:p5")).toHaveCount(1);
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);
  await clickShape(page, "shape:p2");
  await expect(frames(page)).toHaveCount(1);
  expect(new URL((await frames(page).getAttribute("src"))!).host).toBe(`127.0.0.1:${engine.previewPort}`);
});

test("only selected artifacts (three at most), pinned ones (three at most) and the edited one run; the rest show a still that runs nothing", async ({ page, engine }) => {
  await openHosted(page, engine);
  await sixPages(page, engine);
  await expect(frames(page)).toHaveCount(0);
  await expect(shapeOnScreen(page, "shape:p0").getByText("Select to preview")).toBeVisible();

  // Six selected: the three nearest the middle of the view run.
  const viewport = page.viewportSize()!;
  const distances = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(async (index) => {
      const at = await centre(shapeOnScreen(page, `shape:p${index}`));
      return { id: `shape:p${index}`, distance: Math.hypot(at.x - viewport.width / 2, at.y - viewport.height / 2) };
    }),
  );
  const nearest = distances.sort((a, b) => a.distance - b.distance).slice(0, 3).map((entry) => entry.id).sort();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(frames(page)).toHaveCount(3);
  const liveIds = await page.locator(".tl-shape:has(iframe[data-artifact-frame])").evaluateAll((items) => items.map((item) => item.getAttribute("data-shape-id")));
  expect(liveIds.sort()).toEqual(nearest);
  await page.mouse.click(640, 120);
  await expect(frames(page)).toHaveCount(0);

  // Keep playing pins up to three; the fourth is refused, saying why.
  const pin = async (id: string) => {
    const at = await centre(shapeOnScreen(page, id));
    await page.mouse.click(at.x, at.y, { button: "right" });
    const item = page.getByRole("menuitemcheckbox", { name: "Keep playing" }).or(page.getByRole("menuitem", { name: "Keep playing" }));
    await expect(item.first()).toBeVisible();
    return item.first();
  };
  for (const id of ["shape:p0", "shape:p4", "shape:p5"]) {
    await (await pin(id)).click();
    await page.mouse.click(640, 120);
  }
  await expect(frames(page)).toHaveCount(3);
  const refused = await pin("shape:p2");
  await expect(refused).toHaveAttribute("aria-disabled", "true");
  await expect(refused).toHaveAttribute("title", "Three are already playing. Stop one first.");
  await page.keyboard.press("Escape");
  // A pinned one runs whatever is selected; selecting another adds its frame.
  await page.mouse.click(640, 120);
  await clickShape(page, "shape:p2");
  await expect(frames(page)).toHaveCount(4);
  // Unpinning stops it.
  await page.mouse.click(640, 120);
  const unpin = await pin("shape:p0");
  await expect(unpin).toHaveAttribute("aria-checked", "true");
  await unpin.click();
  // The menu may stay open after its checkbox: close it, then leave nothing selected.
  if (await unpin.isVisible()) await page.keyboard.press("Escape");
  await page.mouse.click(640, 120);
  await expect(frames(page)).toHaveCount(2);
  await expect(shapeOnScreen(page, "shape:p0").locator("iframe")).toHaveCount(0);
});

test("a live frame far off screen unmounts, and mounts again on return", async ({ page, engine }) => {
  await openHosted(page, engine);
  await sixPages(page, engine);
  await clickShape(page, "shape:p0");
  await expect(shapeOnScreen(page, "shape:p0").locator("iframe")).toHaveCount(1);
  const width = page.viewportSize()!.width;
  await page.mouse.move(640, 360);
  // Pan well over two view widths away, a little at a time.
  for (let step = 0; step < 30; step++) {
    await page.mouse.wheel(width / 10, 0);
    await page.waitForTimeout(16);
  }
  await expect(shapeOnScreen(page, "shape:p0").locator("iframe")).toHaveCount(0);
  for (let step = 0; step < 30; step++) {
    await page.mouse.wheel(-width / 10, 0);
    await page.waitForTimeout(16);
  }
  await expect(shapeOnScreen(page, "shape:p0").locator("iframe")).toHaveCount(1);
});

test("an artifact that is not live shows its snapshot once the engine has made one, and runs nothing; a new version shows the previous still until its own is made", async ({ page }) => {
  const engine = await startHostedEngine({ env: { UNFRAMED_TEST_RENDERER: "ok" } });
  try {
    await openHosted(page, engine);
    const stillShape = { id: "shape:still", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Still" } as const;
    await filledArtifact(engine, { ...stillShape, html: "<h1>Still</h1>" });
    const shape = shapeOnScreen(page, "shape:still");
    const still = shape.locator("img[data-testid='artifact-snapshot']");
    // The hint shows only until the first snapshot exists, and the stub renderer can finish
    // before the shape first paints, so either one is a correct first state.
    await expect(shape.getByText("Select to preview").or(still)).toBeVisible({ timeout: 10_000 });
    await expect(still).toHaveCount(1, { timeout: 10_000 });
    expect(await still.getAttribute("src")).toMatch(/^\/api\/file\/default\/[^?]+\?snapshot=300x200&v=\d+$/);
    await expect.poll(() => still.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(shape.locator("iframe")).toHaveCount(0);

    // Live while the agent writes a new version, then still again: the previous picture, never the card.
    const first = await still.getAttribute("src");
    await clickShape(page, "shape:still");
    await expect(shape.locator("iframe")).toHaveCount(1);
    const { file } = await filledArtifact(engine, { ...stillShape, html: "<h1>Still, again</h1>" });
    await page.keyboard.press("Escape");
    await expect(shape.locator("iframe")).toHaveCount(0);
    await expect(still).toHaveCount(1);
    await expect(shape.getByText("Select to preview")).toHaveCount(0);
    await expect.poll(() => still.getAttribute("src"), { timeout: 10_000 }).toContain(`/${encodeURIComponent(file)}?`);
    expect(first).not.toContain(`/${encodeURIComponent(file)}?`);
  } finally {
    await engine.dispose();
  }
});
