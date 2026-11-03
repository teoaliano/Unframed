import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import { readFile } from "node:fs/promises";

const OLD = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}</style></head><body><main><h1>Welcome</h1><p>Old text</p></main></body></html>`;

const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const fileOf = async (engine: Parameters<typeof roomShapes>[0]): Promise<string | undefined> =>
  (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:landing")?.props?.file;

test("an artifact written before element editing opens in Edit mode, is prepared and swapped, becomes editable, and Cmd-Z does not bring the old file back", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: OLD });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  const old = (await fileOf(agent))!;

  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();

  await expect.poll(() => fileOf(agent), { timeout: 15_000 }).not.toBe(old);
  const prepared = (await fileOf(agent))!;
  const text = await readFile(projectPath(agent, prepared), "utf8");
  expect(text).toContain('<script src="unframed-dials.js"></script>');
  expect(text).toMatch(/<h1 data-hf-id="hf-[0-9a-z]{4}">Welcome<\/h1>/);
  await expect(readFile(projectPath(agent, old), "utf8")).resolves.toBe(OLD);

  await expect(async () => {
    await frameOf(page).getByRole("heading", { name: "Welcome" }).click();
    await expect(page.locator('[data-edit-outline="selected"]')).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId("design-tab")).toContainText("Welcome");

  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(1500);
  expect(await fileOf(agent)).toBe(prepared);
});
