/** Large boards for the performance budgets, written through the engine as a run would. */
import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { expect } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { putRecords, uploadToEngine } from "./media.ts";

const shape = (id: string, type: string, x: number, y: number, parentId = "page:page") => ({
  id,
  typeName: "shape",
  type,
  x,
  y,
  rotation: 0,
  index: "a1",
  parentId,
  isLocked: false,
  opacity: 1,
});

const richText = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const inBatches = async <T, R>(items: ReadonlyArray<T>, size: number, run: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) results.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  return results;
};

/** Filled images, one uploaded file each, `natural` pixels square, laid out in a grid of `columns`. */
export const imageRecords = async (
  engine: TestEngine,
  count: number,
  options: {
    natural: { w: number; h: number };
    width: number;
    columns: number;
    pitch: { x: number; y: number };
    origin?: { x: number; y: number };
    firstRef?: number;
    bytes?: (index: number) => Buffer;
  },
) => {
  const origin = options.origin ?? { x: 40, y: 40 };
  const files = await inBatches(Array.from({ length: count }, (_, index) => index), 8, (index) =>
    uploadToEngine(engine, `photo-${index}.png`, options.bytes?.(index) ?? pngBytes(options.natural.w, options.natural.h, index % 64), "image/png"),
  );
  return files.flatMap((file, index) => {
    const x = origin.x + (index % options.columns) * options.pitch.x;
    const y = origin.y + Math.floor(index / options.columns) * options.pitch.y;
    const height = (options.width * options.natural.h) / options.natural.w;
    return [
      {
        id: `asset:img-${index}`,
        typeName: "asset",
        type: "image",
        props: { w: options.natural.w, h: options.natural.h, name: `photo-${index}.png`, isAnimated: false, mimeType: "image/png", src: `project-file:${file}` },
        meta: {},
      },
      {
        ...shape(`shape:img-${index}`, "image", x, y),
        props: { w: options.width, h: height, playing: true, url: "", assetId: `asset:img-${index}`, crop: null, flipX: false, flipY: false, altText: "" },
        meta: { ref: String((options.firstRef ?? 1000) + index) },
      },
    ];
  });
};

/**
 * The 300-shape board: 100 filled images with real 1024 by 1024 files, 100 prompts in
 * 20 groups of five, and 80 marks.
 */
export const busyBoard = async (engine: TestEngine) => {
  const images = await imageRecords(engine, 100, { natural: { w: 1024, h: 1024 }, width: 240, columns: 10, pitch: { x: 260, y: 260 } });
  const groups: unknown[] = [];
  const prompts: unknown[] = [];
  for (let group = 0; group < 20; group++) {
    const id = `shape:group-${group}`;
    groups.push({ ...shape(id, "frame", 2760, 20 + group * 130), props: { w: 1740, h: 110, name: String(2000 + group), color: "black" }, meta: {} });
    for (let column = 0; column < 5; column++) {
      const index = group * 5 + column;
      prompts.push({
        ...shape(`shape:prompt-${index}`, "text", 28 + column * 340, 56, id),
        props: { color: "black", size: "s", w: 320, font: "sans", textAlign: "start", autoSize: false, scale: 1, richText: richText(`a prompt about scene ${index}`) },
        meta: { ref: String(3000 + index) },
      });
    }
  }
  const marks = Array.from({ length: 80 }, (_, index) => ({
    ...shape(`shape:mark-${index}`, "geo", 4600 + (index % 8) * 140, 40 + Math.floor(index / 8) * 140),
    props: {
      geo: "rectangle",
      dash: "draw",
      url: "",
      w: 100,
      h: 100,
      growY: 0,
      scale: 1,
      flipX: false,
      flipY: false,
      labelColor: "black",
      color: "black",
      fill: "none",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      richText: { type: "doc", content: [{ type: "paragraph" }] },
    },
    meta: {},
  }));
  await putRecords(engine, [...images, ...groups, ...prompts, ...marks]);
};

/** Opens the app with the frame meter, waits for `shapes` shapes, fits them and lets loading settle. */
export const openMetered = async (page: Page, engine: TestEngine, shapes: number) => {
  await page.goto(`${engine.origin}/?fps=1`);
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(".tl-shape").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(shapes);
  await page.keyboard.press("Shift+1");
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".tl-shape img")].every((image) => image.complete && image.naturalWidth > 0), undefined, {
    timeout: 60_000,
  });
  // Let preview making and image decoding finish: no new requests for two seconds.
  let seen = -1;
  await expect
    .poll(
      async () => {
        const count = await page.evaluate(() => performance.getEntriesByType("resource").length);
        const quiet = count === seen;
        seen = count;
        return quiet;
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__fps?.frameTime() ?? 0)).toBeGreaterThan(0);
};

export interface Measured {
  kind: string;
  frameTime: number;
  gaps: number[];
  median: number;
  overOne: number;
  overTwo: number;
  renders: Record<string, number>;
}

/** The first gesture of `kind` the meter settled after the first `before` gestures, once it has settled. */
export const lastGesture = async (page: Page, before: number, kind?: string): Promise<Measured> => {
  const find = () =>
    page.evaluate(
      ({ before, kind }) => (window as any).__fps.dump().slice(before).find((gesture: Measured) => kind === undefined || gesture.kind === kind) ?? null,
      { before, kind },
    );
  await expect.poll(find, { timeout: 10_000 }).not.toBeNull();
  return (await find())!;
};

export const gestureCount = (page: Page): Promise<number> => page.evaluate(() => (window as any).__fps.dump().length);

/** The budget's numbers for a gesture: median frame gap and the share of frames over 33 ms. */
export const frameStats = (gesture: Measured) => {
  const sorted = [...gesture.gaps].sort((a, b) => a - b);
  const median = sorted.length === 0 ? 0 : sorted[Math.floor((sorted.length - 1) / 2)]!;
  const over33 = gesture.gaps.filter((gap) => gap > 33).length / Math.max(1, gesture.gaps.length);
  return { median, over33, frames: gesture.gaps.length };
};
