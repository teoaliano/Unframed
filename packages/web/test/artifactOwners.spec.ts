import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { BRIDGE_TAG } from "@unframed/domain";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath, writeBridge, writeProjectFile } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const OWNERS = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}#pinned{background:#ffffff !important}</style>${BRIDGE_TAG}</head><body><main><h1 id="title" style="font-size: 32px">Welcome</h1><p id="sum" style="font-size: 16px">Lead text</p><p id="pinned" style="background: #eeeeee">Pinned</p></main>
<script>
unframed.dials("Look", { accent: "#a78bfa", size: [12, 8, 40] }, function (v) {
  document.getElementById("title").style.color = v.accent;
  document.getElementById("sum").style.fontSize = v.size * 2 + "px";
});
</script></body></html>`;

const TEXT_OWNERS = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style>${BRIDGE_TAG}</head><body><main><h1 id="headline" style="font-size: 32px">Placeholder</h1></main>
<script>
unframed.dials("Copy", { headline: "Welcome" }, function (v) {
  document.getElementById("headline").textContent = v.headline;
});
</script></body></html>`;

const FRAME_OWNERS = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style>${BRIDGE_TAG}</head><body><main><p id="card" style="padding: 4px; border: 1px solid #000">Card</p></main>
<script>
unframed.dials("Frame", { pad: 12, edge: "#123456" }, function (v) {
  document.getElementById("card").style.paddingTop = v.pad + "px";
  document.getElementById("card").style.borderColor = v.edge;
});
</script></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Owners" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const parameters = (page: Page) => editor(page).locator('[data-editor-column="parameters"]');
const outline = (page: Page) => page.locator('[data-edit-outline="selected"]');

const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:owners")?.props?.file;
const dialsOf = async (engine: TestEngine): Promise<unknown> => (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:owners")?.props?.dials;
const htmlCount = async (engine: TestEngine): Promise<number> => (await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".html")).length;

const preparedFile = async (engine: TestEngine): Promise<string> => {
  let found = "";
  await expect
    .poll(async () => {
      const file = await fileOf(engine);
      if (file === undefined) return false;
      found = file;
      return (await readFile(projectPath(engine, file), "utf8")).includes("data-hf-id");
    }, { timeout: 20_000 })
    .toBe(true);
  return found;
};

const onBoard = async (page: Page, engine: TestEngine, html: string = OWNERS) => {
  await openCanvas(page, engine);
  await writeBridge(engine);
  await filledArtifact(engine, { id: "shape:owners", kind: "page", ref: "160", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Owners", html });
  await expect(shapeOnScreen(page, "shape:owners")).toBeVisible();
};

const openEditor = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:owners"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

const select = async (page: Page, id: string) => {
  await expect(async () => {
    await frameOf(page).locator(`#${id}`).click();
    await expect(outline(page)).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

test("a dial-driven colour edited in Design moves the dial in Parameters, and the commit writes the dials with no new version, one undo step", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await select(page, "title");
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await expect(parameters(page).getByRole("img", { name: "Parameter accent" })).toBeVisible();
  await parameters(page).getByRole("button", { name: "Colour", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#00ff00");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");

  await expect(frameOf(page).locator("#title")).toHaveCSS("color", "rgb(0, 255, 0)");
  await parameters(page).getByRole("tab", { name: "Parameters" }).click();
  await expect(parameters(page).getByLabel("Accent color value")).toHaveValue("#00ff00");
  await parameters(page).getByRole("tab", { name: "Design" }).click();

  await expect.poll(() => dialsOf(agent), { timeout: 8000 }).toEqual({ accent: "#00ff00" });
  expect(await htmlCount(agent)).toBe(countBefore);
  expect(await fileOf(agent)).toBe(before);

  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(frameOf(page).locator("#title")).toHaveCSS("color", "rgb(167, 139, 250)");
  await expect.poll(() => dialsOf(agent), { timeout: 8000 }).toBeUndefined();
});

test("moving the dial in Parameters moves the field in Design", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await select(page, "title");
  await parameters(page).getByRole("tab", { name: "Parameters" }).click();
  await parameters(page).getByLabel("Accent color value").fill("#ff8800");
  await parameters(page).getByLabel("Accent color value").press("Enter");
  await expect(frameOf(page).locator("#title")).toHaveCSS("color", "rgb(255, 136, 0)");
  await parameters(page).getByRole("tab", { name: "Design" }).click();
  await expect(parameters(page).getByRole("button", { name: "Colour", exact: true })).toContainText("#ff8800");
});

test("an arithmetic value is read-only with the agent's line and an ask button", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await select(page, "sum");
  await expect(parameters(page).getByRole("spinbutton", { name: "Size", exact: true })).toBeDisabled();
  await expect(parameters(page).getByText("Set by the agent's code.")).toBeVisible();
  await expect(parameters(page).getByRole("button", { name: "Ask the agent to make this editable" })).toBeEnabled();
});

test("a stylesheet !important shows its sentence and writes nothing", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await select(page, "pinned");
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await parameters(page).getByRole("button", { name: "Background", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#ff0000");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");
  await expect(parameters(page).getByText("A stylesheet rule wins over this value.")).toBeVisible();
  await page.waitForTimeout(2000);
  expect(await htmlCount(agent)).toBe(countBefore);
  expect(await fileOf(agent)).toBe(before);
});

test("a dial edit and a style edit in one burst land in one version and one undo step", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await select(page, "title");
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await parameters(page).getByRole("button", { name: "Colour", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#00ff00");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");
  await parameters(page).getByRole("spinbutton", { name: "Size", exact: true }).fill("48");
  await parameters(page).getByRole("spinbutton", { name: "Size", exact: true }).press("Enter");

  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  await expect.poll(() => dialsOf(agent), { timeout: 8000 }).toEqual({ accent: "#00ff00" });
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).not.toBe(before);

  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).toBe(before);
  await expect.poll(() => dialsOf(agent), { timeout: 8000 }).toBeUndefined();
});

test("a dial-owned text edited in place writes the dial through the burst, with no new version", async ({ page, agent }) => {
  await onBoard(page, agent, TEXT_OWNERS);
  await openEditor(page);
  await select(page, "headline");
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await frameOf(page).locator("#headline").dblclick();
  await page.keyboard.type("Hello there");
  await page.keyboard.press("Enter");
  await expect(frameOf(page).locator("#headline")).toHaveText("Hello there");

  await expect.poll(() => dialsOf(agent), { timeout: 8000 }).toEqual({ headline: "Hello there" });
  expect(await htmlCount(agent)).toBe(countBefore);
});

test("a dial behind a border or a padding field shows the parameter mark on that field", async ({ page, agent }) => {
  await onBoard(page, agent, FRAME_OWNERS);
  await openEditor(page);
  await select(page, "card");
  await preparedFile(agent);

  await expect(parameters(page).getByRole("img", { name: "Parameter edge" })).toBeVisible();
  await expect(parameters(page).getByRole("img", { name: "Parameter pad" })).toBeVisible();
  await expect(parameters(page).getByRole("group", { name: "Padding" }).getByRole("spinbutton", { name: "Padding top" })).toBeEnabled();
});

test("a burst that holds only a dial, and loses its file to the agent, says the agent rewrote it", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await select(page, "title");
  const before = await preparedFile(agent);

  await parameters(page).getByRole("button", { name: "Colour", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#00ff00");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");

  await writeProjectFile(agent, "agent.html", await readFile(projectPath(agent, before), "utf8"));
  const shape = (await roomShapes(agent, "default", "page")).find((record) => record.id === "shape:owners")!;
  await (await agent.rpc()).call("testCanvas.apply", { project: "default", change: { put: [{ ...shape, props: { ...shape.props, file: "agent.html" } }], remove: [] }, origin: { kind: "server", id: "chat:c9" } });

  await expect(page.getByText("The agent rewrote this. Your last change wasn't saved.", { exact: true }).first()).toBeVisible({ timeout: 2000 });
  expect(await dialsOf(agent)).toBeUndefined();
});
