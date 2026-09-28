/**
 * Browser-seam helpers for the canvas: open the app on an engine, find shapes on screen
 * by their DOM, and read what the engine's room holds.
 */
import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expect } from "./fixtures.ts";

export type AnyRecord = { id: string; typeName: string; type?: string; x?: number; y?: number; props?: any; meta?: any; parentId?: string };

/** Opens the app and waits until the canvas of `project` (the one it opens, by default) is on screen. */
export const openCanvas = async (page: Page, engine: TestEngine, project?: string): Promise<string> => {
  await page.goto(engine.origin);
  const host = project === undefined ? page.locator("[data-canvas-project]") : page.locator(`[data-canvas-project="${project}"]`);
  await expect(host.locator(".tl-canvas")).toBeVisible({ timeout: 20_000 });
  const name = (await host.getAttribute("data-canvas-project"))!;
  const shapes = (await roomRecords(engine, name)).filter((record) => record.typeName === "shape").length;
  await expect.poll(() => host.locator(".tl-shape").count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(shapes);
  return name;
};

/** Waits until a prompt's text editor has the keyboard. */
export const editorFocused = async (page: Page): Promise<void> => {
  await expect(page.locator(".tl-rich-text [contenteditable='true']:focus, [contenteditable='true'].ProseMirror-focused")).toHaveCount(1);
};

/** Presses copy and waits until the system clipboard holds canvas content with `types`. */
export const copySelection = async (page: Page, types: string[] = ["text/html"]): Promise<void> => {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.keyboard.press("ControlOrMeta+c");
  await expect
    .poll(() => page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types)))
    .toEqual(expect.arrayContaining(types));
};

/** A toast on screen, by its text. */
export const toast = (page: Page, text: string | RegExp): Locator => page.locator(".unframed-toast").filter({ hasText: text });

/** Everything the room holds, straight from the engine. */
export const roomRecords = async (engine: TestEngine, project: string): Promise<AnyRecord[]> =>
  (await (await engine.rpc()).call("testCanvas.read", { project })).records as AnyRecord[];

export const roomShapes = async (engine: TestEngine, project: string, type?: string): Promise<AnyRecord[]> =>
  (await roomRecords(engine, project)).filter((record) => record.typeName === "shape" && (type === undefined || record.type === type));

export const shapeOnScreen = (page: Page, id: string): Locator => page.locator(`[data-shape-id="${id}"]`);

export const plainText = (record: AnyRecord | undefined): string =>
  (record?.props?.richText?.content ?? [])
    .map((paragraph: any) => (paragraph.content ?? []).map((node: any) => node.text ?? "").join(""))
    .join("\n");

/** The centre of an element on screen. */
export const centre = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("that element is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A point on empty canvas, clear of every shape (and its label) and of the chrome. */
export const emptyCanvasPoint = async (page: Page): Promise<{ x: number; y: number }> => {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const boxes = await page.locator(".tl-shape").evaluateAll((shapes) =>
    shapes.map((shape) => {
      const rect = shape.getBoundingClientRect();
      return { x: rect.x, y: rect.y - 30, w: rect.width, h: rect.height + 30 };
    }),
  );
  const clear = (x: number, y: number) => boxes.every((box) => x < box.x - 40 || x > box.x + box.w + 40 || y < box.y - 40 || y > box.y + box.h + 40);
  for (const fy of [0.55, 0.45, 0.65, 0.35]) {
    for (const fx of [0.8, 0.2, 0.7, 0.3, 0.6, 0.4]) {
      const point = { x: Math.round(size.width * fx), y: Math.round(size.height * fy) };
      if (clear(point.x, point.y)) return point;
    }
  }
  throw new Error("no empty canvas left on screen");
};

/** A record once the room has stopped changing it (a drag sends many moves). */
export const settledRecord = async (engine: TestEngine, project: string, id: string): Promise<AnyRecord | undefined> => {
  let last = "";
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const found = (await roomRecords(engine, project)).find((record) => record.id === id);
    const text = JSON.stringify(found);
    if (text === last) return found;
    last = text;
  }
};

/** Waits for the room to hold records matching `check`, and answers them. */
export const waitForRoom = async <T>(engine: TestEngine, project: string, check: (records: AnyRecord[]) => T | undefined | false, timeout = 10_000): Promise<T> => {
  let found: T | undefined | false;
  await expect
    .poll(
      async () => {
        found = check(await roomRecords(engine, project));
        return found !== undefined && found !== false;
      },
      { timeout },
    )
    .toBe(true);
  return found as T;
};
