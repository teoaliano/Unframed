import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

export const SHAPE = "shape:landing";

export const editor = (page: Page) => page.getByTestId("artifact-editor");
export const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
export const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);
export const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
export const parameters = (page: Page) => editor(page).locator('[data-editor-column="parameters"]');
export const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
export const modeButton = (page: Page, name: "Edit" | "Interact"): Locator => region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name, exact: true });

export const fileOf = async (engine: TestEngine): Promise<string | undefined> =>
  (await roomShapes(engine, "default", "page")).find((record) => record.id === SHAPE)?.props?.file;

export const htmlCount = async (engine: TestEngine): Promise<number> =>
  (await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".html")).length;

export const textOf = (engine: TestEngine, file: string): Promise<string> => readFile(projectPath(engine, file), "utf8");

export const preparedFile = async (engine: TestEngine): Promise<string> => {
  let found = "";
  await expect
    .poll(
      async () => {
        const file = await fileOf(engine);
        if (file === undefined) return false;
        found = file;
        return (await textOf(engine, file)).includes("data-hf-id");
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found;
};

export const onBoard = async (page: Page, engine: TestEngine, html: string) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
};

export const openEditor = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

export const selectByText = async (page: Page, text: string) => {
  await expect(async () => {
    await frameOf(page).getByText(text, { exact: true }).click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};
