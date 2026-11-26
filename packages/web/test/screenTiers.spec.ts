import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository, zoomOn } from "./screenHarness.ts";

const IDS = ["shape:tier-a", "shape:tier-b", "shape:tier-c"];
const MORE = [...IDS, "shape:tier-d", "shape:tier-e"];

const screenOf = (page: Page, id: string) => page.locator(`[data-shape-id="${id}"] [data-testid=screen]`);

const putBusyScreens = async (page: Page, engine: Parameters<Parameters<typeof withRepository>[2]>[0], project: string, ids: ReadonlyArray<string> = IDS) => {
  const [first] = await screenShapes(engine, project);
  await putShapes(engine, project, [
    { ...first, x: -2000, y: -2000 },
    ...ids.map((id, index) => ({ ...first, id, index: `a${index + 5}`, x: (index % 3) * 440, y: Math.floor(index / 3) * 340, props: { ...first.props, route: `/busy?n=${index}`, w: 390, h: 300 } })),
  ]);
  await page.mouse.click(5, 300);
  await page.keyboard.press("Shift+1");
  for (const id of ids) await expect(screenOf(page, id)).toHaveAttribute("data-picture", /^[a-f0-9]{40}$/, { timeout: 60_000 });
};

const frameOf = (page: Page, id: string) => page.locator(`[data-screen-of="${id}"] iframe[data-screen-frame]`);

const mark = (page: Page, id: string) => page.frameLocator(`[data-screen-of="${id}"] iframe[data-screen-frame]`).locator("body").evaluate((_, id) => ((window as any).__kept = id), id);

const marked = (page: Page, id: string) => page.frameLocator(`[data-screen-of="${id}"] iframe[data-screen-frame]`).locator("body").evaluate(() => (window as any).__kept as string | undefined);

const openFrames = (page: Page) => page.locator("iframe[data-screen-frame]:not([data-parked])").count();

test("only the selected Screen runs live; the last ones stay parked, come back with no reload, and Escape parks with a fresh capture", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(0);
    const [a, b, c] = IDS as [string, string, string];

    await clickShape(page, a);
    await expect(screenOf(page, a)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await expect(screenOf(page, a)).toHaveAttribute("data-tier", "live");
    await page.frameLocator(`[data-screen-of="${a}"] iframe[data-screen-frame]`).locator("body").evaluate(() => ((window as any).__kept = true));

    await clickShape(page, b);
    await expect(screenOf(page, b)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await expect(screenOf(page, a)).toHaveAttribute("data-tier", "parked");
    await expect(page.locator(`[data-screen-of="${a}"] iframe[data-screen-frame]`)).toHaveAttribute("data-parked", "true");
    expect(await openFrames(page)).toBe(1);

    await clickShape(page, c);
    await expect(screenOf(page, c)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    expect(await openFrames(page)).toBe(1);
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(3);

    await clickShape(page, a);
    await expect(screenOf(page, a)).toHaveAttribute("data-painted", "true", { timeout: 2000 });
    expect(await page.frameLocator(`[data-screen-of="${a}"] iframe[data-screen-frame]`).locator("body").evaluate(() => (window as any).__kept === true)).toBe(true);
    expect(await openFrames(page)).toBe(1);

    const before = await screenOf(page, a).getAttribute("data-picture");
    await page.frameLocator(`[data-screen-of="${a}"] iframe[data-screen-frame]`).locator("body").evaluate(() => {
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

test("a board opened zoomed out asks only for the pictures its zoom gives", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    await page.reload();
    await expect(page.locator(`[data-canvas-project="${project}"] .tl-canvas`)).toBeVisible();
    for (const id of IDS) await expect(screenOf(page, id)).toHaveAttribute("data-level", "tiny", { timeout: 10_000 });
    await expect(screenOf(page, IDS[0]!).locator("img[data-testid=screen-snapshot]")).toHaveAttribute("src", /\.w128\.png$/);
    await page.waitForTimeout(500);
    const keys = await Promise.all(IDS.map((id) => screenOf(page, id).getAttribute("data-picture")));
    const fetched = await page.evaluate((keys) => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => keys.some((key) => key !== null && name.includes(key))), keys);
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.filter((name) => !name.endsWith(".w128.png"))).toEqual([]);
  });
});

test("a board whose Screens in view all have pictures opens with no starting cover, even with their dev server stopped", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    await expect(page.locator("[data-testid=screen]:not([data-picture])")).toHaveCount(0, { timeout: 60_000 });
    const [first] = await screenShapes(engine, project);
    const rpc = await engine.rpc();
    try {
      await rpc.call("instances.stop", { project, id: first.props.instance });
      await expect.poll(async () => (await rpc.call("instances.status", { project, id: first.props.instance })).state, { timeout: 30_000 }).toBe("stopped");
    } finally {
      await rpc.close();
    }
    await page.addInitScript(() => {
      (window as any).__covered = false;
      new MutationObserver(() => {
        if (document.querySelector("[data-testid=screens-starting]") !== null) (window as any).__covered = true;
      }).observe(document, { subtree: true, childList: true });
    });
    await page.reload();
    await expect(page.locator(`[data-canvas-project="${project}"] .tl-canvas`)).toBeVisible();
    for (const id of IDS) await expect(screenOf(page, id).locator("img[data-testid=screen-snapshot]")).toBeVisible();
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => (window as any).__covered)).toBe(false);
  });
});

test("a Screen large on screen shows a static copy of its page in a closed shadow root, and a small one an image", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    const [a] = IDS as [string];
    await zoomOn(page, screenOf(page, a), /^page$/, -60);
    const copy = screenOf(page, a).locator("[data-testid=screen-page-copy]");
    await expect(copy).toHaveAttribute("data-built", "true", { timeout: 10_000 });
    await expect(screenOf(page, a)).toHaveAttribute("data-tier", "snapshot");
    expect(await copy.evaluate((element) => element.shadowRoot)).toBeNull();
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(0);
    await zoomOn(page, screenOf(page, a), /^(tiny|small)$/, 60);
    await expect(screenOf(page, a).locator("[data-testid=screen-page-copy]")).toHaveCount(0);
    await expect(screenOf(page, a).locator("img[data-testid=screen-snapshot]")).toHaveAttribute("src", /\.w(128|384)\.png$/);
  });
});

test("a page copy that declares a font the canvas uses leaves the canvas's fonts alone and draws with its own", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    const [a] = IDS as [string];
    await putBusyScreens(page, engine, project, [a]);
    const font = "url(data:font/woff2;base64,AAAA)";
    const html = [
      "<!doctype html><html><head><style>",
      `@font-face { font-family: -apple-system; src: ${font}; }`,
      `@font-face { font-family: "Brand Sans"; src: ${font}; }`,
      `@font-face { font-family: 'Inline Face'; src: ${font}; }`,
      ":root { --brand: \"Brand Sans\", serif; } h1 { font-family: -apple-system, sans-serif; } p { font-family: var(--brand); }",
      "</style></head><body><h1>System</h1><p>Brand</p><span style=\"font-family: 'Inline Face'\">Inline</span></body></html>",
    ].join("");
    const rpc = await engine.rpc();
    let key: string | null;
    try {
      ({ key } = (await rpc.call("screens.capture", { project, shape: a, w: 390, h: 300, html, parts: [] })) as { key: string | null });
    } finally {
      await rpc.close();
    }
    expect(key).toMatch(/^[a-f0-9]{40}$/);
    await expect(screenOf(page, a)).toHaveAttribute("data-picture", key!);
    await zoomOn(page, screenOf(page, a), /^page$/, -60);
    await expect(screenOf(page, a).locator("[data-testid=screen-page-copy]")).toHaveAttribute("data-built", "true", { timeout: 10_000 });
    const faces = () => page.evaluate(() => [...document.fonts].map((face) => ({ family: face.family.replace(/^["']|["']$/g, ""), status: face.status })));
    await expect.poll(async () => (await faces()).filter((face) => /^uf\d+-\d+$/.test(face.family) && face.status !== "unloaded").length, { timeout: 10_000 }).toBe(3);
    const families = (await faces()).map((face) => face.family.toLowerCase());
    expect(families).not.toContain("-apple-system");
    expect(families).not.toContain("brand sans");
    expect(families).not.toContain("inline face");
  });
});

test("one Screen is live and three stay parked at most: a fifth selection drops the oldest frame", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project, MORE);
    for (const id of MORE) {
      await clickShape(page, id);
      await expect(screenOf(page, id)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
      expect(await openFrames(page)).toBe(1);
      expect(await page.locator("iframe[data-screen-frame]").count()).toBeLessThanOrEqual(4);
    }
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(4);
    await expect(frameOf(page, MORE[0]!)).toHaveCount(0);
    await expect(screenOf(page, MORE[0]!)).toHaveAttribute("data-tier", /^(picture|snapshot)$/);
    for (const id of MORE.slice(1, 4)) await expect(screenOf(page, id)).toHaveAttribute("data-tier", "parked");
  });
});

test("a Screen's editor tab makes it live and holds it while open, and parked frames survive the editor and a project tab switch with no reload", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    await putBusyScreens(page, engine, project);
    const [a, b, c] = IDS as [string, string, string];
    for (const id of [a, b]) {
      await clickShape(page, id);
      await expect(screenOf(page, id)).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
      await mark(page, id);
    }
    await page.keyboard.press("Escape");
    await expect(screenOf(page, b)).toHaveAttribute("data-tier", "parked");

    await page.getByTestId("tab-strip").getByRole("tab", { name: "default", exact: true }).click();
    await expect(page.locator("[data-canvas-project='default']")).toBeVisible();
    await expect(page.locator("iframe[data-screen-frame]")).toHaveCount(2);
    await page.getByTestId("tab-strip").getByRole("tab", { name: "my-app", exact: true }).click();
    await expect(screenOf(page, a)).toHaveAttribute("data-tier", "parked");
    expect([await marked(page, a), await marked(page, b)]).toEqual([a, b]);

    await clickShape(page, c);
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Editor" }).click();
    await expect(page.getByTestId("screen-preview")).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
    await expect(frameOf(page, c)).not.toHaveAttribute("data-parked", "true");
    expect(await openFrames(page)).toBe(1);
    await mark(page, c);
    await page.waitForTimeout(500);
    await expect(page.getByTestId("screen-preview")).toHaveAttribute("data-painted", "true");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("artifact-editor")).toHaveCount(0);
    await expect(screenOf(page, c)).toHaveAttribute("data-painted", "true");
    await page.mouse.click(5, 300);
    await expect(screenOf(page, c)).toHaveAttribute("data-tier", "parked");
    expect([await marked(page, a), await marked(page, b), await marked(page, c)]).toEqual([a, b, c]);
    await clickShape(page, a);
    await expect(screenOf(page, a)).toHaveAttribute("data-painted", "true", { timeout: 2000 });
    expect(await marked(page, a)).toBe(a);
  });
});
