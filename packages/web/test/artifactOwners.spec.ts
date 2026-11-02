import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { BRIDGE_TAG } from "@unframed/domain";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath, writeBridge } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/**
 * The owner rule in the Design tab (spec 18, task 33): a dial-driven colour moves its dial, a
 * computed value is read-only with the agent's line, and a stylesheet `!important` wins and writes nothing.
 */

/** Accent colours the title; the summary's size is an arithmetic value on the dial, so it is the agent's code. */
const OWNERS = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}#pinned{background:#ffffff !important}</style>${BRIDGE_TAG}</head><body><main><h1 id="title" style="font-size: 32px">Welcome</h1><p id="sum" style="font-size: 16px">Lead text</p><p id="pinned" style="background-color: #eeeeee">Pinned</p></main>
<script>
unframed.dials("Look", { accent: "#a78bfa", size: [12, 8, 40] }, function (v) {
  document.getElementById("title").style.color = v.accent;
  document.getElementById("sum").style.fontSize = v.size * 2 + "px";
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

/** Waits until the room names the prepared file (one carrying element ids), and answers it: the editor swaps it in before any edit. */
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

const onBoard = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await writeBridge(engine);
  await filledArtifact(engine, { id: "shape:owners", kind: "page", ref: "160", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Owners", html: OWNERS });
  await expect(shapeOnScreen(page, "shape:owners")).toBeVisible();
};

const openEditor = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:owners"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

/** Selects one element of the frame by its id, once the bridge is live and the page is prepared. */
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

  // The colour is a dial's value: its field carries the parameter mark.
  await expect(parameters(page).getByRole("img", { name: "Parameter accent" })).toBeVisible();
  await parameters(page).getByRole("button", { name: "Colour", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#00ff00");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");

  // The frame shows it at once, and the Parameters tab's dial follows.
  await expect(frameOf(page).locator("#title")).toHaveCSS("color", "rgb(0, 255, 0)");
  await parameters(page).getByRole("tab", { name: "Parameters" }).click();
  await expect(parameters(page).getByLabel("Accent color value")).toHaveValue("#00ff00");
  await parameters(page).getByRole("tab", { name: "Design" }).click();

  // The burst writes the dial once, with no version.
  await expect.poll(() => dialsOf(agent), { timeout: 8000 }).toEqual({ accent: "#00ff00" });
  expect(await htmlCount(agent)).toBe(countBefore);
  expect(await fileOf(agent)).toBe(before);

  // One Cmd-Z in the editor takes the adjustment back.
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

test("an arithmetic value is read-only with the agent's line and a disabled ask button", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await select(page, "sum");
  await expect(parameters(page).getByRole("spinbutton", { name: "Size", exact: true })).toBeDisabled();
  await expect(parameters(page).getByText("Set by the agent's code.")).toBeVisible();
  await expect(parameters(page).getByRole("button", { name: "Ask the agent to make this editable" })).toBeDisabled();
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

  // One version for both, with the dial written beside it.
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  await expect.poll(() => dialsOf(agent), { timeout: 8000 }).toEqual({ accent: "#00ff00" });
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).not.toBe(before);

  // One Cmd-Z takes both back.
  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).toBe(before);
  await expect.poll(() => dialsOf(agent), { timeout: 8000 }).toBeUndefined();
});
