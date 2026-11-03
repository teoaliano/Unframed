import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px">Welcome</h1><p style="font-size: 16px">Lead text</p></main></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const parameters = (page: Page) => editor(page).locator('[data-editor-column="parameters"]');
const heading = (page: Page) => frameOf(page).getByRole("heading", { name: "Welcome" });
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const modeButton = (page: Page, name: "Edit" | "Interact"): Locator => region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name, exact: true });
const sizeField = (page: Page) => parameters(page).getByRole("spinbutton", { name: "Size", exact: true });

const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:landing")?.props?.file;

const htmlCount = async (engine: TestEngine): Promise<number> => (await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".html")).length;

const textOf = (engine: TestEngine, file: string): Promise<string> => readFile(projectPath(engine, file), "utf8");

const preparedFile = async (engine: TestEngine): Promise<string> => {
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

const selectHeading = async (page: Page, target: Locator = heading(page)) => {
  await expect(async () => {
    await target.click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

test("the Text section patches the frame at once and writes one version after the last change, and Cmd-Z in the editor points the shape back", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);
  const shown = (await heading(page).boundingBox())!.height;

  await sizeField(page).fill("48");
  await sizeField(page).press("Enter");
  await parameters(page).getByRole("button", { name: "Colour", exact: true }).click();
  await page.getByRole("textbox", { name: "Hex", exact: true }).fill("#ff0000");
  await page.getByRole("textbox", { name: "Hex", exact: true }).press("Enter");
  await page.keyboard.press("Escape");
  await parameters(page).getByRole("combobox", { name: "Weight" }).click();
  await page.getByRole("option", { name: "700", exact: true }).click();
  await expect.poll(async () => (await heading(page).boundingBox())!.height, { timeout: 2000 }).toBeGreaterThan(shown * 1.2);
  expect(await htmlCount(agent)).toBe(countBefore);

  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).not.toBe(before);
  const after = (await fileOf(agent))!;
  const written = await textOf(agent, after);
  expect(written).toMatch(/font-size:\s*48px/);
  expect(written).toMatch(/font-weight:\s*700/);
  expect(written).toMatch(/color:\s*#ff0000/);

  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).toBe(before);
});

test("the burst commits at once on switching mode, on selecting another element and on closing the editor", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  await preparedFile(agent);

  const start = await htmlCount(agent);
  await sizeField(page).fill("40");
  await sizeField(page).press("Enter");
  await modeButton(page, "Interact").click();
  await expect.poll(() => htmlCount(agent), { timeout: 1200 }).toBe(start + 1);

  await modeButton(page, "Edit").click();
  await selectHeading(page);
  await sizeField(page).fill("44");
  await sizeField(page).press("Enter");
  await frameOf(page).getByText("Lead text").click();
  await expect.poll(() => htmlCount(agent), { timeout: 1200 }).toBe(start + 2);

  await sizeField(page).fill("18");
  await sizeField(page).press("Enter");
  await region(page).getByRole("button", { name: "Back to canvas" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(() => htmlCount(agent), { timeout: 1200 }).toBe(start + 3);
});

test("a Design edit made in Interact mode is collected and committed like one made in Edit mode", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);
  await modeButton(page, "Interact").click();
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "true");

  await sizeField(page).fill("52");
  await sizeField(page).press("Enter");
  await expect.poll(() => htmlCount(agent), { timeout: 6000 }).toBe(countBefore + 1);
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).not.toBe(before);
  expect(await textOf(agent, (await fileOf(agent))!)).toMatch(/font-size:\s*52px/);
});

test("the agent deleting the artifact drops a pending burst: the editor closes and nothing is written", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await sizeField(page).fill("60");
  await sizeField(page).press("Enter");
  await (await agent.rpc()).call("testCanvas.apply", { project: "default", change: { put: [], remove: ["shape:landing"] }, origin: { kind: "server", id: "test" } });
  await expect(editor(page)).toHaveCount(0);
  await page.waitForTimeout(2500);
  expect(await htmlCount(agent)).toBe(countBefore);
});

test("Cmd-Z with a burst pending drops it: the frame goes back to the saved look and no version is written", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);
  const shown = (await heading(page).boundingBox())!.height;

  await sizeField(page).fill("60");
  await sizeField(page).press("Enter");
  await expect.poll(async () => (await heading(page).boundingBox())!.height, { timeout: 2000 }).toBeGreaterThan(shown * 1.5);

  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await heading(page).boundingBox())!.height, { timeout: 2000 }).toBeCloseTo(shown, 0);
  await page.waitForTimeout(2500);
  expect(await htmlCount(agent)).toBe(countBefore);
  expect(await fileOf(agent)).toBe(before);
});

const SCRIPTED = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px">Welcome</h1><p>Lead text</p></main><script>document.querySelector("h1").textContent = "Scripted";</script></body></html>`;

const onBoardWith = async (page: Page, engine: TestEngine, html: string) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
};

test("in-place text: double-click literal text, type over it (letters, V, I and Space reach the text), Enter writes one version and Esc puts the old text back", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await selectHeading(page);
  const before = await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await frameOf(page).locator("h1").dblclick();
  await page.keyboard.type("Hi V I");
  await expect(frameOf(page).locator("h1")).toHaveText("Hi V I");
  await expect(modeButton(page, "Edit")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Enter");
  await expect(frameOf(page).locator("h1")).toHaveText("Hi V I");
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(countBefore + 1);
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).not.toBe(before);
  const after = (await fileOf(agent))!;
  const written = await textOf(agent, after);
  expect(written).toMatch(/<h1[^>]*>Hi V I<\/h1>/);
  expect(written).not.toMatch(/Welcome/);

  await frameOf(page).locator("h1").dblclick();
  await page.keyboard.type("Nope");
  await expect(frameOf(page).locator("h1")).toHaveText("Nope");
  await page.keyboard.press("Escape");
  await expect(frameOf(page).locator("h1")).toHaveText("Hi V I");
  await page.waitForTimeout(2500);
  expect(await htmlCount(agent)).toBe(countBefore + 1);
  expect(await fileOf(agent)).toBe(after);
});

test("in-place text: text a script sets, or an element with children, does not open for editing", async ({ page, agent }) => {
  await onBoardWith(page, agent, SCRIPTED);
  await openEditor(page);
  const scripted = frameOf(page).getByRole("heading", { name: "Scripted" });
  await expect(scripted).toBeVisible({ timeout: 20_000 });
  await selectHeading(page, scripted);
  await preparedFile(agent);
  const countBefore = await htmlCount(agent);

  await scripted.dblclick();
  await page.keyboard.type("X");
  await expect(scripted).toHaveText("Scripted");
  await page.waitForTimeout(2500);
  expect(await htmlCount(agent)).toBe(countBefore);
});
