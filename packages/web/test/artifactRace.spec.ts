import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, say, test } from "./agent.ts";
import { filledArtifact, projectPath, writeProjectFile } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { editor, frameOf, outline, parameters, preparedFile, region, textOf } from "./editorHarness.ts";

const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px">Welcome</h1><p style="font-size: 16px">Lead text</p></main></body></html>`;

const heading = (page: Page, name: string) => frameOf(page).getByRole("heading", { name });
const sizeField = (page: Page) => parameters(page).getByRole("spinbutton", { name: "Size", exact: true });
const railOf = (page: Page): Locator => editor(page).getByRole("complementary", { name: "Agent" });

const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:landing")?.props?.file;

const htmlCount = async (engine: TestEngine): Promise<number> => (await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".html")).length;



const onBoard = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
};

const openEditor = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

const selectHeading = async (page: Page) => {
  await expect(async () => {
    await heading(page, "Welcome").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

const pendingSize = async (page: Page, px: string) => {
  await sizeField(page).fill(px);
  await sizeField(page).press("Enter");
};

const WARNING = {
  agent: "The agent rewrote this. Your last change wasn't saved.",
  elsewhere: "This page changed somewhere else. Your last change wasn't saved.",
};

test("a scripted page_write during a pending burst drops the burst, shows the agent's version and the agent's warning", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await pendingSize(page, "40");
  await say(railOf(page), "race the landing page");

  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  await expect(page.getByText(WARNING.agent, { exact: true }).first()).toBeVisible({ timeout: 2000 });
  await expect(heading(page, "Agent version")).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(2500);
  expect(await htmlCount(agent)).toBe(countBefore + 1);
  const written = await textOf(agent, (await fileOf(agent))!);
  expect(written).toMatch(/Agent version/);
  expect(written).not.toMatch(/font-size:\s*40px/);
});

test("a file change made elsewhere under a pending burst drops it with the elsewhere warning and shows that version", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  const prepared = await preparedFile(agent);
  await writeProjectFile(agent, "elsewhere.html", (await textOf(agent, prepared)).replace("Welcome", "Elsewhere version"));
  const countBefore = await htmlCount(agent);

  await pendingSize(page, "40");
  const shape = (await roomShapes(agent, "default", "page")).find((record) => record.id === "shape:landing")!;
  await (await agent.rpc()).call("testCanvas.apply", { project: "default", change: { put: [{ ...shape, props: { ...shape.props, file: "elsewhere.html" } }], remove: [] }, origin: { kind: "server", id: "test" } });

  await expect(page.getByText(WARNING.elsewhere, { exact: true }).first()).toBeVisible({ timeout: 2000 });
  await expect(heading(page, "Elsewhere version")).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(2500);
  expect(await htmlCount(agent)).toBe(countBefore);
  expect(await fileOf(agent)).toBe("elsewhere.html");
});

test("a file that replaces the page keeps the selected elements it still has, and drops the ones it does not", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  await expect(async () => {
    await frameOf(page).getByText("Lead text").click({ modifiers: ["Shift"] });
    await expect(outline(page, "selected")).toHaveCount(2, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  const prepared = await preparedFile(agent);
  await writeProjectFile(agent, "elsewhere.html", (await textOf(agent, prepared)).replace("Welcome", "Elsewhere version").replace(/<p[^>]*>Lead text<\/p>/, ""));
  const shape = (await roomShapes(agent, "default", "page")).find((record) => record.id === "shape:landing")!;
  await (await agent.rpc()).call("testCanvas.apply", { project: "default", change: { put: [{ ...shape, props: { ...shape.props, file: "elsewhere.html" } }], remove: [] }, origin: { kind: "server", id: "test" } });

  await expect(heading(page, "Elsewhere version")).toBeVisible({ timeout: 8000 });
  await expect(outline(page, "selected")).toHaveCount(1);
  await expect(parameters(page).getByText("2 elements")).toHaveCount(0);
  await expect(parameters(page).getByText("Lead text")).toHaveCount(0);
});
