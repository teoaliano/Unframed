import type { Page } from "@playwright/test";
import { makeRepo, repoEngineEnv } from "../../engine/test/gitRepos.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas } from "./canvas.ts";
import { clickShape } from "./generation.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";

const withRepository = async (page: Page, env: Record<string, string>, use: (engine: TestEngine, project: string) => Promise<void>, prepare?: (root: string) => Promise<void>) => {
  const root = await makeRepo("My App");
  await prepare?.(root);
  const engine = await startHostedEngine({ env: await repoEngineEnv({ UNFRAMED_TEST_PICK_FOLDER: root, ...env }) });
  try {
    await openCanvas(page, engine, "default");
    await page.getByRole("button", { name: "All projects" }).click();
    await page.getByRole("menuitem", { name: "Add Repository…" }).click();
    await expect(page.locator("[data-canvas-project='my-app'] .tl-canvas")).toBeVisible();
    await use(engine, "my-app");
  } finally {
    await engine.dispose();
  }
};

const screenShapes = async (engine: TestEngine, project: string) => {
  const rpc = await engine.rpc();
  try {
    return ((await rpc.call("testCanvas.read", { project })).records as any[]).filter((record) => record.typeName === "shape" && record.type === "screen");
  } finally {
    await rpc.close();
  }
};

test("a new Repository's first Screen goes live through the proxy at /, keeps its snapshot until first paint, and drops to the snapshot off screen", async ({ page }) => {
  await withRepository(page, { UNFRAMED_TEST_RENDERER: "ok" }, async (engine, project) => {
    const screen = page.locator("[data-testid=screen]");
    await expect(screen).toHaveCount(1);
    await expect(screen).toHaveAttribute("data-route", "/");
    const frame = screen.locator("iframe[data-screen-frame]");
    await expect(frame).toHaveAttribute("src", /^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 30_000 });
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-modals");
    await expect(frame).toHaveAttribute("allow", "");
    await expect(page.frameLocator("[data-testid=screen] iframe[data-screen-frame]").getByRole("heading", { name: "Fake app" })).toBeVisible();
    await expect(screen).toHaveAttribute("data-painted", "true");
    await expect(frame).toHaveCSS("pointer-events", "none");

    await clickShape(page, (await screenShapes(engine, project))[0].id);
    await expect(frame).toHaveCSS("pointer-events", "auto");
    await expect(screen.locator("[data-testid=screen-snapshot]")).toHaveCount(0);
    await page.keyboard.press("Escape");

    const width = page.viewportSize()!.width;
    await page.mouse.move(640, 360);
    for (let step = 0; step < 80; step++) {
      await page.mouse.wheel(width / 10, 0);
      await page.waitForTimeout(16);
    }
    await expect(screen.locator("iframe")).toHaveCount(0);
    await expect(screen.locator("[data-testid=screen-snapshot]")).toHaveCount(1);
    expect((await screenShapes(engine, project))[0].props).toMatchObject({ route: "/", w: 1280, h: 800 });
  });
});
