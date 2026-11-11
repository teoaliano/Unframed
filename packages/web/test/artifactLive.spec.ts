import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { filledArtifact, insideFrame, writeProjectFile } from "./artifacts.ts";

const frames = (page: Page) => page.locator(".tl-shape iframe[data-artifact-frame]");

const openHosted = async (page: Page, engine: TestEngine) => {
  await page.goto(`http://127.0.0.1:${engine.port}/`);
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
};

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
  const session = await page.context().newCDPSession(page);
  await expect
    .poll(async () => {
      const { targetInfos } = (await session.send("Target.getTargets")) as { targetInfos: Array<{ type: string; url: string }> };
      return targetInfos.filter((target) => target.type === "iframe" && target.url.startsWith(`http://localhost:${engine.previewPort}/p/`)).length;
    })
    .toBe(2);
  await session.detach();

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
  await page.mouse.click(640, 120);
  await clickShape(page, "shape:p2");
  await expect(frames(page)).toHaveCount(4);
  await page.mouse.click(640, 120);
  const unpin = await pin("shape:p0");
  await expect(unpin).toHaveAttribute("aria-checked", "true");
  await unpin.click();
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
    await expect(shape.getByText("Select to preview").or(still)).toBeVisible({ timeout: 10_000 });
    await expect(still).toHaveCount(1, { timeout: 10_000 });
    expect(await still.getAttribute("src")).toMatch(/^\/api\/file\/default\/[^?]+\?snapshot=300x200&mode=none&kit=none&v=\d+$/);
    await expect.poll(() => still.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(shape.locator("iframe")).toHaveCount(0);

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

test("a live page reloads when its own file or a file it loads changes on disk, keeping its file", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeProjectFile(engine, "live-app.js", "document.getElementById('out').textContent = 'Script one';");
  const { file } = await filledArtifact(engine, {
    id: "shape:live",
    kind: "page",
    ref: "150",
    at: { x: 420, y: 60 },
    title: "Live",
    html: `<!doctype html><html><body><h1 id="out">Loading</h1><script src="live-app.js?v=1"></script></body></html>`,
  });
  await clickShape(page, "shape:live");
  const heading = insideFrame(page, "shape:live").getByRole("heading");
  await expect(heading).toHaveText("Script one");

  await writeProjectFile(engine, "live-app.js", "document.getElementById('out').textContent = 'Script two';");
  await expect(heading).toHaveText("Script two", { timeout: 10_000 });

  await writeProjectFile(engine, file, `<!doctype html><html><body><h1 id="out">Edited in place</h1></body></html>`);
  await expect(heading).toHaveText("Edited in place", { timeout: 10_000 });
  await writeProjectFile(engine, "unrelated.js", "1");
  await page.waitForTimeout(1500);
  await expect(heading).toHaveText("Edited in place");
});

const counted = (label: string) =>
  `sessionStorage.loads = String(Number(sessionStorage.loads || 0) + 1); document.getElementById('out').textContent = ${JSON.stringify(label)};`;

const loadsOf = async (page: Page, id: string): Promise<number> => {
  const frame = await shapeOnScreen(page, id).locator("iframe[data-artifact-frame]").elementHandle();
  return Number(await (await frame!.contentFrame())!.evaluate(() => sessionStorage.loads ?? 0));
};

test("a script written in chunks reloads a live page once, after the writes go quiet", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeProjectFile(engine, "chunked.js", counted("Chunk 0"));
  await filledArtifact(engine, { id: "shape:chunked", kind: "page", ref: "150", at: { x: 420, y: 60 }, title: "Chunked", html: `<!doctype html><html><body><h1 id="out">Loading</h1><script src="chunked.js"></script></body></html>` });
  await clickShape(page, "shape:chunked");
  const heading = insideFrame(page, "shape:chunked").getByRole("heading");
  await expect(heading).toHaveText("Chunk 0");
  await expect.poll(() => loadsOf(page, "shape:chunked")).toBe(1);

  for (let chunk = 1; chunk <= 6; chunk++) {
    await writeProjectFile(engine, "chunked.js", counted(`Chunk ${chunk}`));
    await page.waitForTimeout(300);
  }
  await expect(heading).toHaveText("Chunk 6", { timeout: 10_000 });
  await page.waitForTimeout(2000);
  expect(await loadsOf(page, "shape:chunked")).toBe(2);
});

test("a live page with the focus inside it waits to reload until the focus leaves, keeping what the person typed", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeProjectFile(engine, "form.js", "document.getElementById('out').textContent = 'Form one';");
  await filledArtifact(engine, {
    id: "shape:form",
    kind: "page",
    ref: "150",
    at: { x: 420, y: 60 },
    title: "Form",
    html: `<!doctype html><html><body><h1 id="out">Loading</h1><input aria-label="Name"><script src="form.js"></script></body></html>`,
  });
  await clickShape(page, "shape:form");
  const inside = insideFrame(page, "shape:form");
  await expect(inside.getByRole("heading")).toHaveText("Form one");
  await inside.getByRole("textbox", { name: "Name" }).fill("kept");
  await inside.getByRole("textbox", { name: "Name" }).focus();

  await writeProjectFile(engine, "form.js", "document.getElementById('out').textContent = 'Form two';");
  await page.waitForTimeout(3000);
  await expect(inside.getByRole("heading")).toHaveText("Form one");
  await expect(inside.getByRole("textbox", { name: "Name" })).toHaveValue("kept");

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(inside.getByRole("heading")).toHaveText("Form two", { timeout: 5_000 });
});
