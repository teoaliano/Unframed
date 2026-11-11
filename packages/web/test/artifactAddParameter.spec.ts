import type { Page } from "@playwright/test";
import { addParameterInstruction, applyParametersInstruction } from "@unframed/domain";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { createChat, engineChat, engineChats, expect, test, userTexts } from "./agent.ts";
import { test as plain } from "./fixtures.ts";
import { dialsPage, filledArtifact, writeBridge } from "./artifacts.ts";
import { editor } from "./editorHarness.ts";

const box = (page: Page) => editor(page).getByRole("textbox", { name: "Add a parameter" });
const toggle = (page: Page) => editor(page).getByRole("button", { name: "Add a parameter" });

const openOnPage = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await writeBridge(engine);
  await filledArtifact(engine, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [12, 8, 40] }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  const at = await centre(shapeOnScreen(page, "shape:tuned"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Tuned" })).toBeVisible();
  await editor(page).locator('[data-editor-column="parameters"]').getByRole("tab", { name: "Parameters" }).click();
};

test("the box is folded behind an icon button in the parameters' header row, which opens it focused and folds it again, as Escape does", async ({ page, agent }) => {
  await openOnPage(page, agent);
  await expect(box(page)).toHaveCount(0);
  const header = editor(page).getByTestId("artifact-dials").locator(".dialkit-panel-header");
  await expect(header.getByRole("button", { name: "Versions" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Add a parameter" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Apply" })).toBeVisible();
  const [versions, button, apply] = await Promise.all([header.getByRole("button", { name: "Versions" }).boundingBox(), toggle(page).boundingBox(), header.getByRole("button", { name: "Apply" }).boundingBox()]);
  expect(Math.abs(versions!.y + versions!.height / 2 - (button!.y + button!.height / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(apply!.y + apply!.height / 2 - (button!.y + button!.height / 2))).toBeLessThanOrEqual(1);
  expect(button!.x).toBeGreaterThan(versions!.x + versions!.width - 1);
  expect(apply!.x).toBeGreaterThan(button!.x + button!.width - 1);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

  await toggle(page).click();
  await expect(box(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  const composer = (await editor(page).getByTestId("add-parameter-composer").boundingBox())!;
  const headerBox = (await header.boundingBox())!;
  const firstFolder = (await editor(page).getByTestId("artifact-dials").getByText("Size", { exact: true }).boundingBox())!;
  expect(composer.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  expect(composer.y + composer.height).toBeLessThanOrEqual(firstFolder.y);

  await toggle(page).click();
  await expect(box(page)).toHaveCount(0);
  await toggle(page).click();
  await box(page).fill("the title size");
  await page.keyboard.press("Escape");
  await expect(box(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Editing Tuned" })).toBeVisible();
  expect(await engineChats(agent)).toEqual([]);
});

test("Add sends the premade instruction into a new chat tagged with the artifact, opens the rail on it and folds the box", async ({ page, agent }) => {
  await openOnPage(page, agent);
  await toggle(page).click();
  const add = editor(page).getByRole("button", { name: "Add", exact: true });
  await expect(add).toBeDisabled();
  await box(page).fill("the accent colour and the intro speed");
  await expect(add).toBeEnabled();
  await expect(editor(page).getByText("The agent writes it")).toBeVisible();
  await box(page).press("Shift+Enter");
  await expect(box(page)).toHaveValue("the accent colour and the intro speed\n");
  await box(page).fill("the accent colour and the intro speed");
  await box(page).press("Enter");

  await expect(box(page)).toHaveCount(0, { timeout: 10_000 });
  const [chat] = await engineChats(agent);
  expect(chat?.tags).toEqual(["shape:tuned"]);
  expect(await userTexts(agent, chat!.id)).toEqual([addParameterInstruction({ wanted: "the accent colour and the intro speed", kind: "page", title: "Tuned" })]);
  const sent = (await engineChat(agent, chat!.id)).messages.find((message) => message.role === "user");
  expect(sent?.context?.selection).toEqual(["shape:tuned"]);
  await expect(editor(page).locator('[data-editor-column="rail"]').getByRole("tab", { selected: true })).toHaveCount(1);
});

test("Add continues the artifact's own idle chat when it has one", async ({ page, agent }) => {
  await openOnPage(page, agent);
  const chatId = await createChat(agent, { title: "About tuned", tags: ["shape:tuned"] });
  await createChat(agent, { title: "Elsewhere" });
  await expect(editor(page).getByRole("tab", { name: /About tuned/ })).toBeVisible();
  await toggle(page).click();
  await box(page).fill("the title size");
  await editor(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(box(page)).toHaveCount(0, { timeout: 10_000 });
  expect(await engineChats(agent)).toHaveLength(2);
  expect(await userTexts(agent, chatId)).toEqual([addParameterInstruction({ wanted: "the title size", kind: "page", title: "Tuned" })]);
  await expect(editor(page).getByRole("tab", { name: /About tuned/, selected: true })).toBeVisible();
});

plain("with no provider ready, Add says to connect one, keeps the box open and sends nothing", async ({ page, engine }) => {
  await openOnPage(page, engine);
  await toggle(page).click();
  await box(page).fill("the title size");
  await editor(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(editor(page).getByRole("alert").filter({ hasText: "Connect Claude or Codex first." })).toBeVisible();
  await expect(box(page)).toHaveValue("the title size");
  expect(await engineChats(engine)).toEqual([]);
});

test("Apply sends the current values into the artifact's own chat as the new defaults, and says so", async ({ page, agent }) => {
  await openOnPage(page, agent);
  const chatId = await createChat(agent, { title: "About tuned", tags: ["shape:tuned"] });
  await expect(editor(page).getByRole("tab", { name: /About tuned/ })).toBeVisible();
  await expect(editor(page).getByRole("button", { name: "Copy parameters" })).toBeHidden();
  const apply = editor(page).getByRole("button", { name: "Apply" });
  await apply.click();
  await expect(editor(page).getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  expect(await engineChats(agent)).toHaveLength(1);
  expect(await userTexts(agent, chatId)).toEqual([applyParametersInstruction({ name: "Look", kind: "page", title: "Tuned", values: { size: 12 } })]);
  const sent = (await engineChat(agent, chatId)).messages.find((message) => message.role === "user");
  expect(sent?.context?.selection).toEqual(["shape:tuned"]);
  await expect(editor(page).getByRole("tab", { name: /About tuned/, selected: true })).toBeVisible();
  await expect(editor(page).locator('[data-editor-column="rail"]').getByText(/Update the unframed\.dials configuration for "Look"/)).toBeVisible();
});

plain("with no provider ready, Apply says to connect one and sends nothing", async ({ page, engine }) => {
  await openOnPage(page, engine);
  await editor(page).getByRole("button", { name: "Apply" }).click();
  await expect(editor(page).getByRole("alert").filter({ hasText: "Connect Claude or Codex first." })).toBeVisible();
  expect(await engineChats(engine)).toEqual([]);
});
