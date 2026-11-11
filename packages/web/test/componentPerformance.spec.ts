import type { Page } from "@playwright/test";
import { compiledFileName } from "@unframed/domain";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expectFrameBudget, frameStats, gestureCount, lastGesture } from "./board.ts";
import { shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { artifactShape, writeProjectFile } from "./artifacts.ts";
import { componentShape, sheetHtml } from "./components.ts";
import { putRecords } from "./media.ts";

const COMPONENTS = 5;
const PAGES = 10;

const oldSheet = (index: number) => `1761400${index}000-card-${index}.html`;
const newSheet = (index: number) => `1761500${index}000-card-${index}.html`;
const tagOf = (index: number) => `uf-card-${index}`;

const pageHtml = (index: number, sheet: string) =>
  `<!doctype html><html><head><script src="${compiledFileName(sheet)}" data-uf-component="${tagOf(index)}"></script></head><body style="margin:0;font:16px sans-serif"><${tagOf(index)} label="Buy ${index}"></${tagOf(index)}></body></html>`;

const boardOf = async (engine: TestEngine) => {
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "default" }).catch(() => undefined);
  const records: unknown[] = [];
  for (let index = 0; index < COMPONENTS; index++) {
    const tag = tagOf(index);
    await writeProjectFile(engine, oldSheet(index), sheetHtml({ tag, variants: { kind: ["primary", "secondary"] } }));
    await writeProjectFile(engine, newSheet(index), sheetHtml({ tag, variants: { kind: ["primary", "secondary", "ghost"] } }));
    records.push(componentShape({ id: `shape:card-${index}`, ref: String(100 + index), at: { x: index * 520, y: -420 }, file: newSheet(index), tag, title: `Card ${index}` }));
  }
  for (let index = 0; index < PAGES; index++) {
    const component = index % COMPONENTS;
    const sheet = index < COMPONENTS ? oldSheet(component) : newSheet(component);
    const file = `page-${index}.html`;
    await writeProjectFile(engine, file, pageHtml(component, sheet));
    records.push(artifactShape({ id: `shape:page-${index}`, kind: "page", ref: String(200 + index), at: { x: (index % 5) * 520, y: Math.floor(index / 5) * 360 }, size: { w: 480, h: 320 }, file, title: `Page ${index}` }));
  }
  await putRecords(engine, records);
};

const panFor = async (page: Page, durationMs: number) => {
  await page.mouse.move(640, 360);
  const started = Date.now();
  for (let step = 0; Date.now() - started < durationMs; step++) {
    const direction = Math.floor(step / 60) % 2 === 0 ? 1 : -1;
    await page.mouse.wheel(10 * direction, 6 * direction);
    await page.waitForTimeout(16);
  }
};

test("ten pages pinning five components, five behind, pan for 4 s in the hosted shape within the frame budget", async ({ page, engine }) => {
  await boardOf(engine);
  await page.goto(`http://127.0.0.1:${engine.port}/?fps=1`);
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(".tl-shape[data-shape-type='page'], .tl-shape[data-shape-type='component']").count(), { timeout: 20_000 }).toBe(COMPONENTS + PAGES);
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(500);

  await expect(page.getByTestId("component-updates-badge")).toHaveCount(5, { timeout: 20_000 });
  await expect(shapeOnScreen(page, "shape:page-0")).toBeVisible();

  await page.waitForTimeout(3000);
  await expect.poll(() => page.evaluate(() => (window as any).__fps?.frameTime() ?? 0)).toBeGreaterThan(0);

  const before = await gestureCount(page);
  await panFor(page, 4000);
  const pan = await lastGesture(page, before, "wheel");
  const stats = frameStats(pan);
  console.log(`component board pan: median ${stats.median.toFixed(2)} ms, over 33 ms ${(stats.over33 * 100).toFixed(2)} % of ${stats.frames} frames, display frame ${pan.frameTime.toFixed(2)} ms`);
  expect(pan.kind).toBe("wheel");
  expectFrameBudget(stats, "component board pan", { median: 16.7, over33: 0.02 });
});
