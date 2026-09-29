import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";
import { filledArtifact } from "./artifacts.ts";
import { toolbar } from "./generation.ts";
import { expectSlot, expectToken } from "./kit.ts";

const COMPOSITION = '<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"><div id="a" class="clip" data-start="0" data-duration="2">Intro</div></div>';

const withRenderer = test.extend<{ renderer: "ok" | "fail" }>({
  renderer: ["ok", { option: true }],
  engine: async ({ renderer }, use) => {
    const engine = await startHostedEngine({ env: { UNFRAMED_TEST_RENDERER: renderer } });
    await use(engine);
    await engine.dispose();
  },
});

const motionOnBoard = async (page: Page, engine: TestEngine, project = "default") => {
  await openCanvas(page, engine, project === "default" ? undefined : project);
  // Left of the starter prompts, where the view opens, with room below it for the render row.
  const { file } = await filledArtifact(engine, { id: "shape:intro", kind: "motion", ref: "150", at: { x: -420, y: -40 }, size: { w: 400, h: 240 }, title: "Intro", html: COMPOSITION, project });
  const shape = shapeOnScreen(page, "shape:intro");
  await expect(shape).toBeVisible();
  // Render lives in the selection toolbar and the editor's header, not under the motion.
  await expect(shape.getByRole("button", { name: "Render" })).toHaveCount(0);
  const box = (await shape.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y - 8);
  await expect(renderButton(page)).toBeVisible();
  return { file, shape };
};

const renderButton = (page: Page) => toolbar(page).getByRole("button", { name: "Render" });

const placeholderOf = (records: Awaited<ReturnType<typeof roomRecords>>) => records.find((record) => record.type === "video");

withRenderer("Render puts a placeholder beside the motion at once, shows the progress and message, and the engine fills it", async ({ page, engine }) => {
  const { shape } = await motionOnBoard(page, engine);
  await renderButton(page).click();
  const placeholder = await waitForRoom(engine, "default", (records) => placeholderOf(records));
  expect(placeholder.meta.unframed.run).toMatchObject({ runIndex: 1 });
  expect(placeholder.props).toMatchObject({ w: 320, h: 180, assetId: null });
  const motion = (await roomRecords(engine, "default")).find((record) => record.id === "shape:intro")!;
  expect(placeholder.x).toBe(motion.x! + motion.props.w + 40);
  await expect(shapeOnScreen(page, placeholder.id).getByText("Generating…")).toBeVisible();

  await expect(renderButton(page)).toBeDisabled();
  await expectSlot(renderButton(page), "button");
  // The kit's progress look: a spinner, a thin bar filling in the primary colour, the muted percentage.
  const progress = shape.getByTestId("render-progress");
  await expect(progress).toHaveText(/^\d+% · (Capturing frames|Encoding|Finishing)$/, { timeout: 5000 });
  await expect(progress.locator("svg[aria-label='Loading']")).toHaveCount(1);
  await expectToken(progress.getByTestId("render-fill"), "background-color", "--highlight");
  await expectToken(progress, "color", "--color-muted-foreground");
  const filled = await waitForRoom(engine, "default", (records) => {
    const video = records.find((record) => record.id === placeholder.id);
    return video?.props.assetId ? video : undefined;
  });
  expect(filled.meta.unframed?.run).toBeUndefined();
  const asset = (await roomRecords(engine, "default")).find((record) => record.id === filled.props.assetId)!;
  expect(asset.props.name).toMatch(/^\d+-intro\.mp4$/);
  await expect(renderButton(page)).toBeEnabled();
  await expect(shape.getByTestId("render-progress")).toHaveCount(0);
  await expect(shapeOnScreen(page, filled.id).locator("video")).toHaveCount(1);
});

withRenderer.describe("a render that fails", () => {
  withRenderer.use({ renderer: "fail" });

  withRenderer("removes its placeholder and shows its error under the motion until the next render starts", async ({ page, engine }) => {
    const { shape } = await motionOnBoard(page, engine);
    await renderButton(page).click();
    await waitForRoom(engine, "default", (records) => placeholderOf(records));
    await expect(shape.getByRole("alert")).toHaveText("Stub render failed.", { timeout: 10_000 });
    await expectToken(shape.getByRole("alert"), "color", "--color-destructive-foreground");
    await expect.poll(async () => placeholderOf(await roomRecords(engine, "default"))).toBeUndefined();
    await expect(renderButton(page)).toBeEnabled();
    await renderButton(page).click();
    await expect(shape.getByRole("alert")).toHaveCount(0);
  });
});

withRenderer("a render goes to the project it started in, whatever the tab shows meanwhile; a restart mid-render clears its placeholder", async ({ page, engine }) => {
  const rpc = await engine.rpc();
  const { shape } = await motionOnBoard(page, engine);
  await rpc.call("projects.create", { name: "other" });
  await renderButton(page).click();
  const placeholder = await waitForRoom(engine, "default", (records) => placeholderOf(records));

  // Switch project in the tab while it renders.
  await page.locator(".unframed-chrome-left").getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "other" }).click();
  await expect(page.locator('[data-canvas-project="other"] .tl-canvas')).toBeVisible();
  await waitForRoom(engine, "default", (records) => typeof records.find((record) => record.id === placeholder.id)?.props.assetId === "string", 15_000);
  expect((await roomRecords(engine, "other")).filter((record) => record.type === "video")).toEqual([]);
  expect((await readdir(join(engine.dataDir, "output", "other"))).filter((name) => name.endsWith(".mp4"))).toEqual([]);
  expect((await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".mp4"))).toHaveLength(1);

  // An engine that stops mid-render leaves a placeholder no process will fill: the next boot clears it.
  const started = await rpc.call("motion.renderStart", { project: "default", file: (await roomRecords(engine, "default")).find((record) => record.id === "shape:intro")!.props.file, shapeId: "shape:intro" });
  expect((await roomRecords(engine, "default")).some((record) => record.id === started.placeholder)).toBe(true);
  await engine.stop("SIGKILL");
  const restarted = await startHostedEngine({ dataDir: engine.dataDir, env: { UNFRAMED_TEST_RENDERER: "ok" } });
  try {
    await expect.poll(async () => (await roomRecords(restarted, "default")).some((record) => record.id === started.placeholder), { timeout: 10_000 }).toBe(false);
    expect(existsSync(join(engine.dataDir, "output", "default"))).toBe(true);
  } finally {
    await restarted.dispose();
  }
});

withRenderer("an open motion renders from the editor's header, and the canvas shows the progress under it", async ({ page, engine }) => {
  const { shape } = await motionOnBoard(page, engine);
  const box = (await shape.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const header = page.getByRole("region", { name: "Editing Intro" });
  await expect(header).toBeVisible();
  await header.getByRole("button", { name: "Render" }).click();
  await waitForRoom(engine, "default", (records) => placeholderOf(records));
  await expect(header.getByRole("button", { name: "Render" })).toBeDisabled();
});
