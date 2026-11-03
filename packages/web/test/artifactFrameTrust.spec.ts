import { readFile } from "node:fs/promises";
import type { Frame, Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { engineChat, engineChats, expect, say, test } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A page with two elements that carry ids, so the frame can name one. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 data-hf-id="hf-aaaa">Welcome</h1><p data-hf-id="hf-bbbb">Lead text</p></main></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const rowOf = (page: Page, label: string): Locator => column(page, "parameters").locator("[data-layer-row]").filter({ hasText: label }).first();
const modeButton = (page: Page, name: "Edit" | "Interact"): Locator => region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name, exact: true });

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

/** The artifact frame's own document, from which a page would send its messages. */
const frameWindow = async (page: Page): Promise<Frame> => {
  const handle = await region(page).locator("iframe[data-artifact-frame]").elementHandle();
  const frame = await handle!.contentFrame();
  if (frame === null) throw new Error("no frame");
  return frame;
};

test("a text message from the frame with no text edit pending writes nothing", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await column(page, "parameters").getByRole("tab", { name: "Layers" }).click();
  await expect(outline(page, "selected")).toHaveCount(0);
  await expect.poll(async () => (await textOf(agent)).includes("Lead text"), { timeout: 20_000 }).toBe(true);

  const frame = await frameWindow(page);
  await frame.evaluate(() => window.parent.postMessage({ type: "unframed:edit:text", id: "hf-bbbb", text: "INJECTED" }, "*"));
  await page.waitForTimeout(2500);
  expect(await textOf(agent)).not.toContain("INJECTED");
  await expect(frameOf(page).getByText("Lead text")).toBeVisible();
});

test("a key message from the frame is ignored outside Edit mode", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await column(page, "parameters").getByRole("tab", { name: "Layers" }).click();
  await expect(column(page, "parameters").locator("[data-layer-row]").first()).toBeVisible({ timeout: 20_000 });
  await rowOf(page, "Lead text").locator("[data-layer]").click();
  await expect(rowOf(page, "Lead text").locator("[data-layer]")).toHaveAttribute("aria-pressed", "true");

  await modeButton(page, "Interact").click();
  const frame = await frameWindow(page);
  await frame.evaluate(() => window.parent.postMessage({ type: "unframed:edit:key", key: "Escape", shift: false, meta: false, ctrl: false }, "*"));
  await page.waitForTimeout(300);
  await expect(rowOf(page, "Lead text").locator("[data-layer]")).toHaveAttribute("aria-pressed", "true");
});

/** A page whose script adds an element with a 300-character id: its live selector is the id, which a chip carries. */
const LONG_ID = "x".repeat(300);
const RUNTIME_PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 data-hf-id="hf-aaaa">Welcome</h1></main><script>const made = document.createElement("p"); made.id = "${LONG_ID}"; made.textContent = "Made by script"; document.body.appendChild(made);</script></body></html>`;

test("a runtime element's selector reaches the agent capped at 200 characters", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:pg1", kind: "page", ref: "pg1", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: RUNTIME_PAGE });
  await expect(shapeOnScreen(page, "shape:pg1")).toBeVisible();
  await openEditor(page);

  await expect(async () => {
    await frameOf(page).getByText("Made by script").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await region(page).getByRole("button", { name: "Tell the agent" }).first().click();
  await say(editor(page).getByRole("complementary", { name: "Agent" }), "check this element");

  await expect
    .poll(async () => {
      const [summary] = await engineChats(agent);
      return summary === undefined ? "" : JSON.stringify(await engineChat(agent, summary.id));
    }, { timeout: 20_000 })
    .toContain("x".repeat(100));
  const [summary] = await engineChats(agent);
  const stored = JSON.stringify(await engineChat(agent, summary!.id));
  expect(stored).not.toContain("x".repeat(201));
});
