import { readFile } from "node:fs/promises";
import type { Frame, Page } from "@playwright/test";
import { TOKENS_TAG, type Kit } from "@unframed/domain";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { clickShape } from "./generation.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import { putRecords } from "./media.ts";

const kitWith = (primary: string): Kit => ({
  format: 1,
  name: "Brand",
  modes: ["light"],
  tokens: [{ path: "color/brand/primary", type: "color", value: primary }],
});

const writeKit = (engine: Parameters<typeof putRecords>[0], kit: Kit) =>
  putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }]);

const swatchPage = () =>
  `<!doctype html><html><head>${TOKENS_TAG}<style>body{margin:0}</style></head><body><div id="swatch" style="width:300px;height:200px;background:var(--color-brand-primary)"></div></body></html>`;

const frameState = async (page: Page, file: string) => {
  const frame = page.frames().find((candidate: Frame) => candidate.url().endsWith(`/${file}`));
  if (!frame) return undefined;
  return frame.evaluate(() => {
    const swatch = document.getElementById("swatch");
    return swatch === null ? undefined : { colour: getComputedStyle(swatch).backgroundColor, marker: (window as unknown as { __kitMarker?: number }).__kitMarker ?? null };
  });
};

test("a token change reaches a live page and the editor's frame without a reload", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeKit(agent, kitWith("#1a73e8"));
  await expect.poll(() => readFile(projectPath(agent, "unframed-tokens.js"), "utf8").then((text) => text.includes("#1a73e8"), () => false)).toBe(true);

  const { file } = await filledArtifact(agent, { id: "shape:brand", kind: "page", ref: "160", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Brand", html: swatchPage() });
  await expect(shapeOnScreen(page, "shape:brand")).toBeVisible();
  await clickShape(page, "shape:brand");
  await expect.poll(async () => (await frameState(page, file))?.colour).toBe("rgb(26, 115, 232)");
  await page.frames().find((candidate: Frame) => candidate.url().endsWith(`/${file}`))!.evaluate(() => {
    (window as unknown as { __kitMarker?: number }).__kitMarker = 7;
  });

  await writeKit(agent, kitWith("#d93025"));
  await expect.poll(async () => (await frameState(page, file))?.colour).toBe("rgb(217, 48, 37)");
  expect((await frameState(page, file))?.marker).toBe(7);

  const at = await centre(shapeOnScreen(page, "shape:brand"));
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(async () => (await frameState(page, file))?.colour).toBe("rgb(217, 48, 37)");
  await page.frames().find((candidate: Frame) => candidate.url().endsWith(`/${file}`))!.evaluate(() => {
    (window as unknown as { __kitMarker?: number }).__kitMarker = 8;
  });
  await writeKit(agent, kitWith("#188038"));
  await expect.poll(async () => (await frameState(page, file))?.colour).toBe("rgb(24, 128, 56)");
  expect((await frameState(page, file))?.marker).toBe(8);
});

test("removing the kit clears the tokens a live frame shows, with no reload", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeKit(agent, kitWith("#1a73e8"));
  await expect.poll(() => readFile(projectPath(agent, "unframed-tokens.js"), "utf8").then((text) => text.includes("#1a73e8"), () => false)).toBe(true);

  const { file } = await filledArtifact(agent, { id: "shape:brand", kind: "page", ref: "160", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Brand", html: swatchPage() });
  await expect(shapeOnScreen(page, "shape:brand")).toBeVisible();
  await clickShape(page, "shape:brand");
  await expect.poll(async () => (await frameState(page, file))?.colour).toBe("rgb(26, 115, 232)");
  await page.frames().find((candidate: Frame) => candidate.url().endsWith(`/${file}`))!.evaluate(() => {
    (window as unknown as { __kitMarker?: number }).__kitMarker = 9;
  });

  await putRecords(agent, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: {} } }]);
  await expect.poll(async () => (await frameState(page, file))?.colour).toBe("rgba(0, 0, 0, 0)");
  expect((await frameState(page, file))?.marker).toBe(9);
});
