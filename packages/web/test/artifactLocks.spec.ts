import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { engineChats, engineChat, expect, say, test } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A page whose heading the scripted agent tries to rewrite: `hf-aaaa` is the element the fixture names. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 data-hf-id="hf-aaaa">Welcome</h1><p data-hf-id="hf-bbbb">Lead text</p></main></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const rows = (page: Page) => column(page, "parameters").locator("[data-layer-row]");
const rowOf = (page: Page, label: string): Locator => rows(page).filter({ hasText: label }).first();

/** The Landing page's file and the lock it carries in the room. The room lags the editor by a sync round, so reads poll. */
const pageShape = async (engine: TestEngine) => (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:pg1");
const textOf = async (engine: TestEngine): Promise<string> => {
  const file = (await pageShape(engine))?.props?.file;
  return file === undefined ? "" : readFile(projectPath(engine, file), "utf8");
};

const onBoard = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:pg1", kind: "page", ref: "pg1", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:pg1")).toBeVisible();
};

const openEditor = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:pg1"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

const openLayers = async (page: Page) => {
  await column(page, "parameters").getByRole("tab", { name: "Layers" }).click();
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
};

test("locking in Layers writes lockedElements as one undo step, refuses a pick in the frame, and makes the Design fields read-only", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await openLayers(page);

  await column(page, "parameters").getByRole("button", { name: "Lock Welcome" }).click();
  await expect.poll(async () => (await pageShape(agent))?.props?.lockedElements, { timeout: 8000 }).toEqual(["hf-aaaa"]);

  // One undo step: Cmd-Z takes the lock back and nothing else.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await pageShape(agent))?.props?.lockedElements, { timeout: 8000 }).toBeUndefined();
  await column(page, "parameters").getByRole("button", { name: "Lock Welcome" }).click();
  await expect.poll(async () => (await pageShape(agent))?.props?.lockedElements, { timeout: 8000 }).toEqual(["hf-aaaa"]);

  // A locked element cannot be picked in the frame.
  await expect(async () => {
    await frameOf(page).getByRole("heading", { name: "Welcome" }).click();
    await page.waitForTimeout(150);
    await expect(outline(page, "selected")).toHaveCount(0);
  }).toPass({ timeout: 20_000 });
  await frameOf(page).getByText("Lead text").click();
  await expect(outline(page, "selected")).toHaveCount(1);

  // Selected from its row, a locked element is read-only in Design, with the plain reason.
  await rowOf(page, "Welcome").locator("[data-layer]").click();
  await column(page, "parameters").getByRole("tab", { name: "Design" }).click();
  await expect(column(page, "parameters").getByText("Locked. Unlock it in Layers to edit it.")).toBeVisible();
  await expect(column(page, "parameters").getByRole("spinbutton", { name: "Size", exact: true })).toBeDisabled();
});

test("the agent's write that changes a locked element is refused and leaves the file as it was; unlocking lets the next write through", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await openLayers(page);
  await column(page, "parameters").getByRole("button", { name: "Lock Welcome" }).click();
  await expect.poll(async () => (await pageShape(agent))?.props?.lockedElements, { timeout: 8000 }).toEqual(["hf-aaaa"]);

  // The scripted agent's first turn rewrites the heading: refused, so the page keeps its heading.
  await say(column(page, "rail"), "locked: rewrite the heading");
  await expect.poll(async () => (await engineChats(agent)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const [summary] = await engineChats(agent);
      return summary === undefined ? "" : JSON.stringify(await engineChat(agent, summary.id));
    }, { timeout: 20_000 })
    .toContain("is locked by the person");
  expect(await textOf(agent)).toContain("Welcome");
  expect(await textOf(agent)).not.toContain("Changed");

  // Unlocked, the next turn's write goes through.
  await rowOf(page, "Welcome").getByRole("button", { name: "Unlock Welcome" }).click();
  await expect.poll(async () => (await pageShape(agent))?.props?.lockedElements, { timeout: 8000 }).toBeUndefined();
  await say(column(page, "rail"), "locked: keep the heading and add a line");
  await expect.poll(() => textOf(agent), { timeout: 20_000 }).toMatch(/<p[^>]*>More<\/p>/);
});
