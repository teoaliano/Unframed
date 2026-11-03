import type { Page } from "@playwright/test";
import { compiledFileName, MAKE_COMPONENT_TEMPLATE } from "@unframed/domain";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { engineChat, engineChats, expect, test } from "./agent.ts";
import { test as plain } from "./fixtures.ts";
import { componentShape, SHEET_FILE, writeSheet } from "./components.ts";
import { putRecords } from "./media.ts";
import { editor, frameOf, onBoard, openEditor, outline, parameters, SHAPE, selectByText } from "./editorHarness.ts";
import { filledArtifact, writeProjectFile } from "./artifacts.ts";

/** Spec 20, task 36: Make component on one plain element; shown for nothing else. */

/** A heading and a paragraph: two elements the person can point at. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1 style="font-size: 32px">Welcome</h1><p style="font-size: 16px">Lead text</p></main></body></html>`;

/** A page with one instance of a component and its pin. */
const INSTANCE_PAGE = `<!doctype html><html><head><script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif"><uf-price-card label="Buy"></uf-price-card></body></html>`;

const makeButton = (page: Page) => parameters(page).getByRole("button", { name: "Make component", exact: true });

test("Make component sends the element's chip and the fixed instruction to a new chat tagged with the artifact, and opens it", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await selectByText(page, "Lead text");
  await expect(makeButton(page)).toBeEnabled();

  await makeButton(page).click();

  await expect.poll(async () => (await engineChats(agent)).length).toBe(1);
  const [chat] = await engineChats(agent);
  expect(chat!.tags).toEqual([SHAPE]);
  const sent = await engineChat(agent, chat!.id);
  const user = sent.messages.find((message) => message.role === "user");
  expect(user?.text).toBe(MAKE_COMPONENT_TEMPLATE.split("<kind>").join("page").replace("<title>", "Landing"));
  expect(user?.context?.elements).toEqual([expect.objectContaining({ shapeId: SHAPE, tag: "p", label: "Lead text" })]);
  await expect(editor(page).locator('[data-editor-column="rail"]').getByText("Make a component from the element attached to this message", { exact: false }).first()).toBeVisible();
});

test("Make component is disabled on a locked element, with its tooltip", async ({ page, agent }) => {
  await onBoard(page, agent, PAGE);
  await openEditor(page);
  await parameters(page).getByRole("tab", { name: "Layers" }).click();
  await expect(parameters(page).getByRole("button", { name: "Lock Lead text" })).toBeVisible({ timeout: 20_000 });
  await parameters(page).getByRole("button", { name: "Lock Lead text" }).click();
  // Selected from Layers, where a locked element is still picked.
  await parameters(page).locator("[data-layer-row]").filter({ hasText: "Lead text" }).first().click();
  await parameters(page).getByRole("tab", { name: "Design" }).click();

  await expect(makeButton(page)).toHaveAttribute("aria-disabled", "true", { timeout: 20_000 });
  await makeButton(page).hover();
  await expect(page.getByText("Unlock it first. The agent replaces it with the component.", { exact: true })).toBeVisible();
});

test("Make component is hidden for an instance", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeSheet(agent, { tag: "uf-price-card", variants: {} });
  await putRecords(agent, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await filledArtifact(agent, { id: SHAPE, kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: INSTANCE_PAGE });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await openEditor(page);
  await expect(async () => {
    await frameOf(page).locator("uf-price-card").first().locator("button").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(parameters(page).getByTestId("instance-section")).toBeVisible({ timeout: 20_000 });
  await expect(makeButton(page)).toHaveCount(0);
});

plain("with no provider ready, Make component says to connect one and sends nothing", async ({ page, engine }) => {
  await onBoard(page, engine, PAGE);
  await openEditor(page);
  await selectByText(page, "Lead text");

  await makeButton(page).click();

  await expect(page.getByRole("alert").filter({ hasText: "Connect Claude or Codex first." })).toBeVisible();
  expect(await engineChats(engine)).toHaveLength(0);
});
