import type { Page } from "@playwright/test";
import { applyParametersInstruction } from "@unframed/domain";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { connectTab } from "../../engine/test/syncClient.ts";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { createChat, engineChats, expect, openRail, rail, test, userTexts } from "./agent.ts";
import { dialsPage, filledArtifact, writeBridge } from "./artifacts.ts";
import { clickShape } from "./generation.ts";
import { editor } from "./editorHarness.ts";

const look = (values: Record<string, unknown>) => applyParametersInstruction({ name: "Look", kind: "page", title: "Tuned", values });
const parametersToggle = (page: Page) => page.getByTestId("selection-toolbar").getByRole("button", { name: "Parameters" });
const canvasPanel = (page: Page) => page.getByRole("region", { name: "Parameters for Tuned" });

const onBoard = async (page: Page, engine: TestEngine, at = { x: -520, y: -40 }) => {
  await openCanvas(page, engine);
  await writeBridge(engine);
  await filledArtifact(engine, { id: "shape:tuned", kind: "page", ref: "150", at, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [12, 8, 40] }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
};

const editorFrame = (page: Page) => editor(page).frameLocator("iframe[data-artifact-frame]");

const setFromAnotherTab = async (engine: TestEngine, dials: Record<string, unknown>) => {
  const tab = await connectTab(engine.port, "default");
  await tab.loaded;
  const current = tab.get("shape:tuned");
  await tab.put([{ ...current, props: { ...current.props, dials } }]);
  await tab.close();
};

const openEditorParameters = async (page: Page) => {
  const at = await centre(shapeOnScreen(page, "shape:tuned"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Tuned" })).toBeVisible();
  await editor(page).locator('[data-editor-column="parameters"]').getByRole("tab", { name: "Parameters" }).click();
  await expect(editor(page).getByRole("button", { name: "Apply" })).toBeVisible();
};

test("in the editor, Apply sends to the chat its rail shows, even when it is not the artifact's newest", async ({ page, agent }) => {
  await onBoard(page, agent);
  const older = await createChat(agent, { title: "Older", tags: ["shape:tuned"], createdAt: "2026-01-01T00:00:00.000Z" });
  const newer = await createChat(agent, { title: "Newer", tags: ["shape:tuned"], createdAt: "2026-01-02T00:00:00.000Z" });
  await openEditorParameters(page);
  const railColumn = editor(page).locator('[data-editor-column="rail"]');
  await railColumn.getByRole("tab", { name: /Older/ }).click();
  await expect(railColumn.getByRole("tab", { name: /Older/, selected: true })).toBeVisible();

  await editor(page).getByRole("button", { name: "Apply" }).click();
  await expect(editor(page).getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  expect(await userTexts(agent, older)).toEqual([look({ size: 12 })]);
  expect(await userTexts(agent, newer)).toEqual([]);
  await expect(railColumn.getByRole("tab", { name: /Older/, selected: true })).toBeVisible();
});

test("in the editor with no chat shown, Apply starts the artifact's own chat and shows it", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditorParameters(page);
  await editor(page).getByRole("button", { name: "Apply" }).click();
  await expect(editor(page).getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  const [chat] = await engineChats(agent);
  expect(chat?.tags).toEqual(["shape:tuned"]);
  expect(await userTexts(agent, chat!.id)).toEqual([look({ size: 12 })]);
  await expect(editor(page).locator('[data-editor-column="rail"]').getByRole("tab", { selected: true })).toHaveCount(1);
});

test("on the canvas with the rail open on a chat, Apply sends there and leaves the rail as it is", async ({ page, agent }) => {
  await onBoard(page, agent, { x: 120, y: -40 });
  const older = await createChat(agent, { title: "Older", tags: ["shape:tuned"], createdAt: "2026-01-01T00:00:00.000Z" });
  const newer = await createChat(agent, { title: "Newer", tags: ["shape:tuned"], createdAt: "2026-01-02T00:00:00.000Z" });
  await clickShape(page, "shape:tuned");
  const panel = await openRail(page);
  await panel.getByRole("tab", { name: /Older/ }).click();
  await expect(panel.getByRole("tab", { name: /Older/, selected: true })).toBeVisible();
  await parametersToggle(page).click();
  await canvasPanel(page).getByRole("button", { name: "Apply" }).click();
  await expect(canvasPanel(page).getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  expect(await userTexts(agent, older)).toEqual([look({ size: 12 })]);
  expect(await userTexts(agent, newer)).toEqual([]);
  await expect(rail(page).getByRole("tab", { name: /Older/, selected: true })).toBeVisible();
});

test("on the canvas with the rail closed, Apply uses the artifact's own chat and opens the rail on it", async ({ page, agent }) => {
  await onBoard(page, agent);
  const own = await createChat(agent, { title: "Own", tags: ["shape:tuned"] });
  await clickShape(page, "shape:tuned");
  await parametersToggle(page).click();
  await expect(rail(page)).toHaveCount(0);
  await canvasPanel(page).getByRole("button", { name: "Apply" }).click();
  await expect(canvasPanel(page).getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  expect(await userTexts(agent, own)).toEqual([look({ size: 12 })]);
  await expect(rail(page).getByRole("tab", { name: /Own/, selected: true })).toBeVisible();
});

test("a double-click on Apply sends once, and Add a parameter waits while it sends", async ({ page, agent }) => {
  await onBoard(page, agent);
  const own = await createChat(agent, { title: "Own", tags: ["shape:tuned"] });
  await openEditorParameters(page);
  await editor(page).getByRole("button", { name: "Apply" }).dblclick();
  await expect(editor(page).getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  await expect(editor(page).locator('[data-editor-column="rail"]').getByText(/^Update the unframed\.dials configuration/)).toHaveCount(1);
  expect(await userTexts(agent, own)).toEqual([look({ size: 12 })]);
});

test("Apply sends the values the shape holds now, also after another tab changed them", async ({ page, agent }) => {
  await onBoard(page, agent);
  const own = await createChat(agent, { title: "Own", tags: ["shape:tuned"] });
  await openEditorParameters(page);
  await expect(editorFrame(page).locator("#values")).toHaveText('{"size":12}');
  await setFromAnotherTab(agent, { size: 30 });
  await expect(editorFrame(page).locator("#values")).toHaveText('{"size":30}', { timeout: 10_000 });
  await editor(page).getByRole("button", { name: "Apply" }).click();
  await expect(editor(page).getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  expect(await userTexts(agent, own)).toEqual([look({ size: 30 })]);
});

test("a dial moved here after another tab's change is what Apply sends", async ({ page, agent }) => {
  await onBoard(page, agent);
  const own = await createChat(agent, { title: "Own", tags: ["shape:tuned"] });
  await openEditorParameters(page);
  await setFromAnotherTab(agent, { size: 30 });
  await expect(editorFrame(page).locator("#values")).toHaveText('{"size":30}', { timeout: 10_000 });
  const slider = editor(page).getByTestId("artifact-dials").getByRole("slider", { name: "Size" });
  await slider.focus();
  await page.keyboard.press("ArrowUp");
  await expect(editorFrame(page).locator("#values")).toHaveText('{"size":13}');
  await editor(page).getByRole("button", { name: "Apply" }).click();
  await expect(editor(page).getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  expect(await userTexts(agent, own)).toEqual([look({ size: 13 })]);
});

test("on the canvas, a sent box leaves the focus to the rail it opened rather than taking it back to its button", async ({ page, agent }) => {
  await onBoard(page, agent);
  await clickShape(page, "shape:tuned");
  await parametersToggle(page).click();
  const panel = canvasPanel(page);
  await panel.getByRole("button", { name: "Add a parameter" }).click();
  await panel.getByRole("textbox", { name: "Add a parameter" }).fill("the title size");
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("textbox", { name: "Add a parameter" })).toHaveCount(0, { timeout: 10_000 });
  await expect(rail(page)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Add a parameter" })).not.toBeFocused();
  expect(await engineChats(agent)).toHaveLength(1);
});

