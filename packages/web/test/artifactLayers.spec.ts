import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A page with a heading, a paragraph, a box with a span in it, and a paragraph a script adds at run time. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1>Welcome</h1><p>Lead text</p><div class="box"><span>Inside</span></div></main><script>document.body.appendChild(Object.assign(document.createElement("p"), { textContent: "Made by script" }));</script></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const rows = (page: Page) => column(page, "parameters").locator("[data-layer-row]");
/** The Layers row whose text names `label`: its button selects, and its icons hide, lock and rename. */
const rowOf = (page: Page, label: string): Locator => rows(page).filter({ hasText: label }).first();
const layerButton = (page: Page, label: string): Locator => rowOf(page, label).locator("[data-layer]");

/** The file the Landing page shape names in the room. The room lags the editor by a sync round, so reads poll. */
const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:landing")?.props?.file;
const textOf = async (engine: TestEngine): Promise<string> => {
  const file = await fileOf(engine);
  return file === undefined ? "" : readFile(projectPath(engine, file), "utf8");
};

const onBoard = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
};

const openLayers = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await column(page, "parameters").getByRole("tab", { name: "Layers" }).click();
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
};

test("Layers lists the elements in document order, with the runtime element greyed and read-only", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openLayers(page);
  await expect(rows(page)).toHaveCount(5);
  const names = await column(page, "parameters").locator("[data-layer] .truncate").allTextContents();
  expect(names).toEqual(["main", "Welcome", "Lead text", "box", "Inside"]);
  const runtime = column(page, "parameters").locator("[data-layer-runtime]");
  await expect(runtime).toContainText("Set by the agent's code");
  await expect(runtime.locator("div").first()).toHaveClass(/opacity-60/);
  // The box is a parent: it nests its span one step deeper than itself.
  expect(await rows(page).nth(4).evaluate((item) => (item as HTMLElement).style.paddingInlineStart)).toBe("24px");
});

test("selection works both ways, and a row hovered in the list outlines its element in the frame", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openLayers(page);

  await layerButton(page, "Lead text").click();
  await expect(outline(page, "selected")).toHaveCount(1);
  await expect(layerButton(page, "Lead text")).toHaveAttribute("aria-pressed", "true");

  await expect(async () => {
    await frameOf(page).getByRole("heading", { name: "Welcome" }).click();
    await expect(layerButton(page, "Welcome")).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  await rowOf(page, "box").hover();
  await expect(outline(page, "hover")).toHaveCount(1, { timeout: 5000 });
});

test("rename writes data-uf-name, and an empty name removes it so the derived label comes back", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openLayers(page);

  await layerButton(page, "Lead text").dblclick();
  const field = column(page, "parameters").getByRole("textbox", { name: "Layer name" });
  await field.fill("Intro");
  await field.press("Enter");
  await expect(rowOf(page, "Intro")).toBeVisible();
  await expect.poll(() => textOf(agent), { timeout: 8000 }).toMatch(/data-uf-name="Intro"/);

  await layerButton(page, "Intro").dblclick();
  await column(page, "parameters").getByRole("textbox", { name: "Layer name" }).fill("");
  await column(page, "parameters").getByRole("textbox", { name: "Layer name" }).press("Enter");
  await expect(rowOf(page, "Lead text")).toBeVisible();
  await expect.poll(() => textOf(agent), { timeout: 8000 }).not.toMatch(/data-uf-name="Intro"/);
});

test("hide takes the element out of the frame and shows its row dimmed; show brings it back", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openLayers(page);

  await column(page, "parameters").getByRole("button", { name: "Hide Lead text" }).click();
  await expect(frameOf(page).getByText("Lead text")).toBeHidden();
  await expect(column(page, "parameters").getByRole("button", { name: "Show Lead text" })).toBeVisible();
  await expect(layerButton(page, "Lead text").locator("span").first()).toHaveClass(/opacity-50/);
  await expect.poll(() => textOf(agent), { timeout: 8000 }).toMatch(/data-uf-hidden/);

  await column(page, "parameters").getByRole("button", { name: "Show Lead text" }).click();
  await expect(frameOf(page).getByText("Lead text")).toBeVisible();
});
