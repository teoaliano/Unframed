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
  await expect.poll(() => page.locator(".tl-shape").count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
  return name;
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

/** A point on empty canvas: the lower right area, clear of the chrome and the starter prompts. */
export const emptyCanvasPoint = async (page: Page): Promise<{ x: number; y: number }> => {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  return { x: Math.round(size.width * 0.62), y: Math.round(size.height * 0.62) };
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
