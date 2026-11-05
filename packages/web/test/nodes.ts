import type { Locator, Page } from "@playwright/test";
import type { TLRecord } from "tldraw";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { roomRecords, shapeOnScreen, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect } from "./fixtures.ts";

export { nodeShape, wireShape } from "../../engine/test/nodeRecords.ts";
export { imageShape, promptShape, groupShape, pageShape } from "../../engine/test/canvasRecords.ts";

export const seedBoard = async (engine: TestEngine, put: TLRecord[], project = "default"): Promise<void> => {
  const rpc = await engine.rpc();
  const existing = (await roomRecords(engine, project)).filter((record) => record.typeName === "shape").map((record) => record.id);
  if (existing.length > 0) await rpc.call("testCanvas.apply", { project, change: { put: [], remove: existing }, origin: { kind: "system", id: "test-clear" } });
  await rpc.call("testCanvas.apply", { project, change: { put, remove: [] }, origin: { kind: "system", id: "test-seed" } });
};

export const imageAsset = (id: string, file: string, w = 96, h = 64): TLRecord =>
  ({ id: `asset:${id}`, typeName: "asset", type: "image", props: { w, h, name: file, isAnimated: false, mimeType: "image/png", src: `project-file:${file}` }, meta: {} }) as unknown as TLRecord;

export const nodeCard = (page: Page, id: string): Locator => shapeOnScreen(page, `shape:${id}`).getByTestId("node-card");

export const selectNode = async (page: Page, id: string): Promise<void> => {
  const card = nodeCard(page, id);
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width - 24, box.y + 14);
  await expect(card).toHaveAttribute("data-node-live", "true");
};

export const nodeRecord = async (engine: TestEngine, id: string): Promise<AnyRecord | undefined> => (await roomRecords(engine, "default")).find((record) => record.id === `shape:${id}`);

export const waitForNode = (engine: TestEngine, id: string, check: (props: any) => boolean) =>
  waitForRoom(engine, "default", (records) => {
    const node = records.find((record) => record.id === `shape:${id}`);
    return node && check(node.props) ? node : undefined;
  });

export const wires = async (engine: TestEngine): Promise<AnyRecord[]> => (await roomRecords(engine, "default")).filter((record) => record.type === "wire");

export const drawWire = async (page: Page, fromId: string, to: { x: number; y: number }): Promise<void> => {
  const box = (await shapeOnScreen(page, fromId).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const handle = page.getByTestId("wire-handle");
  await expect(handle).toHaveAttribute("data-wire-from", fromId);
  const at = (await handle.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move((at.x + to.x) / 2, (at.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
};

export const centreOf = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

export const clickShape = async (page: Page, id: string): Promise<void> => {
  const point = await centreOf(shapeOnScreen(page, id));
  await page.mouse.click(point.x, point.y);
};

