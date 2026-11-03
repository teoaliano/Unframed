import type { FrameLocator, Locator, Page } from "@playwright/test";
import { TOKENS_TAG, type Kit } from "@unframed/domain";
import { centre, openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { clickShape } from "./generation.ts";
import { filledArtifact } from "./artifacts.ts";
import { putRecords } from "./media.ts";

const kit: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
};

const writeKit = (engine: Parameters<typeof putRecords>[0], next: Kit) =>
  putRecords(engine, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: next } } }]);

const swatchPage = () =>
  `<!doctype html><html><head>${TOKENS_TAG}<style>body{margin:0}</style></head><body><div id="swatch" style="width:300px;height:200px;background:var(--color-brand-primary)"></div></body></html>`;

const modeOf = async (engine: Parameters<typeof roomRecords>[0], id: string) =>
  ((await roomRecords(engine, "default")).find((record) => record.id === id)?.props as { mode?: string } | undefined)?.mode;

const swatchIn = (frame: FrameLocator) => frame.locator("#swatch").evaluate((element) => getComputedStyle(element).backgroundColor);

const pickMode = async (page: Page, scope: Locator, option: string) => {
  await scope.getByRole("combobox", { name: "Kit mode" }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

test("the Kit mode picker sets a shape's mode from the toolbar and the editor header, one undo step each", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeKit(agent, kit);
  await filledArtifact(agent, { id: "shape:brand", kind: "page", ref: "170", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Brand", html: swatchPage() });
  await expect(shapeOnScreen(page, "shape:brand")).toBeVisible();

  await clickShape(page, "shape:brand");
  const toolbar = page.getByTestId("selection-toolbar");
  await expect(toolbar.getByRole("combobox", { name: "Kit mode" })).toHaveText("light");
  await pickMode(page, toolbar, "dark");
  await expect.poll(() => modeOf(agent, "shape:brand")).toBe("dark");
  await expect(toolbar.getByRole("combobox", { name: "Kit mode" })).toHaveText("dark");

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => modeOf(agent, "shape:brand")).toBeUndefined();

  const at = await centre(shapeOnScreen(page, "shape:brand"));
  await page.mouse.dblclick(at.x, at.y);
  const editor = page.getByTestId("artifact-editor");
  const frame = editor.frameLocator("iframe[data-artifact-frame]");
  await expect.poll(() => swatchIn(frame)).toBe("rgb(26, 115, 232)");
  await pickMode(page, editor, "dark");
  await expect.poll(() => modeOf(agent, "shape:brand")).toBe("dark");
  await expect.poll(() => swatchIn(frame)).toBe("rgb(138, 180, 248)");

  await pickMode(page, editor, "light (default)");
  await expect.poll(() => modeOf(agent, "shape:brand")).toBeUndefined();
  await expect.poll(() => swatchIn(frame)).toBe("rgb(26, 115, 232)");
});
