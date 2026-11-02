import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";

/** A page with a heading, a paragraph inside a main element, and a link that would leave the page if followed. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}</style></head><body><main><h1>Welcome</h1><p>Lead text</p><a href="https://example.invalid/">Go</a></main></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const modeButton = (page: Page, name: "Edit" | "Interact"): Locator => region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name, exact: true });

const onBoard = async (page: Page, engine: Parameters<typeof openCanvas>[1]) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
};

const openEditor = async (page: Page) => {
  // Deselect first: a selected artifact's frame takes a double-click as its own.
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

/** Waits until the bridge is live: the page is prepared and swapped in first, so early input can land on the old document. */
const live = async (page: Page) => {
  await expect(async () => {
    await heading(page).click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(outline(page, "selected")).toHaveCount(0);
};

const heading = (page: Page) => frameOf(page).getByRole("heading", { name: "Welcome" });

test("the editor opens in Edit mode, with a Mode toggle and the Design, Layers and Parameters tabs, and V and I switch from the editor and from inside the frame", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);

  await expect(modeButton(page, "Edit")).toHaveAttribute("aria-pressed", "true");
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "false");
  const tabs = column(page, "parameters").getByRole("tablist");
  await expect(tabs.getByRole("tab")).toHaveText(["Design", "Layers", "Parameters"]);
  await expect(column(page, "parameters").getByRole("tab", { name: "Design" })).toHaveAttribute("aria-selected", "true");

  // Keys typed in the editor switch the mode.
  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("i");
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(modeButton(page, "Edit")).toHaveAttribute("aria-pressed", "true");

  // Keys typed inside the frame reach the editor through the bridge.
  await live(page);
  await heading(page).click();
  await expect(outline(page, "selected")).toHaveCount(1);
  await page.keyboard.press("i");
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(modeButton(page, "Edit")).toHaveAttribute("aria-pressed", "true");
});

test("the chosen tab is remembered for the session, and the Design tab is shown on open", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await column(page, "parameters").getByRole("tab", { name: "Layers" }).click();
  await expect(column(page, "parameters").getByRole("tab", { name: "Layers" })).toHaveAttribute("aria-selected", "true");

  await region(page).getByRole("button", { name: "Back to canvas" }).click();
  await expect(editor(page)).toHaveCount(0);
  await openEditor(page);
  await expect(column(page, "parameters").getByRole("tab", { name: "Layers" })).toHaveAttribute("aria-selected", "true");
});

test("the header fits a 1024 px window with the Mode toggle in it", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await onBoard(page, agent);
  const shown = (await shapeOnScreen(page, "shape:landing").boundingBox())!;
  // The window shows only part of the page: double-click the middle of what shows.
  await page.mouse.dblclick((Math.max(shown.x, 0) + Math.min(shown.x + shown.width, 1024)) / 2, shown.y + shown.height / 2);
  await expect(region(page)).toBeVisible();
  const header = column(page, "centre").locator("header").first();
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(modeButton(page, "Edit")).toBeVisible();
  await expect(modeButton(page, "Interact")).toBeVisible();
});

test("Edit mode on a page: hover outline, click selects, Shift-click adds, Shift+Enter selects the parent, Esc clears and then closes, and a link does not navigate", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);

  await live(page);
  // The outline follows the pointer over an element that is not selected.
  const at = await centre(heading(page));
  await expect(async () => {
    await page.mouse.move(at.x - 2, at.y);
    await page.mouse.move(at.x, at.y);
    await expect(outline(page, "hover")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  await heading(page).click();
  await expect(outline(page, "selected")).toHaveCount(1);
  await expect(column(page, "parameters").getByTestId("design-tab")).toContainText("Welcome");

  await frameOf(page).getByText("Lead text").click({ modifiers: ["Shift"] });
  await expect(outline(page, "selected")).toHaveCount(2);

  await heading(page).click();
  await page.keyboard.press("Shift+Enter");
  await expect(outline(page, "selected")).toHaveCount(1);
  await expect(outline(page, "selected")).toContainText("main");

  // Esc clears the selection first; the editor stays open.
  await page.keyboard.press("Escape");
  await expect(outline(page, "selected")).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
});

test("a link does not navigate in Edit mode, and Interact leaves a click on the page alone", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);
  await live(page);

  await frameOf(page).getByRole("link", { name: "Go" }).click();
  await expect(heading(page)).toBeVisible();
  await expect(outline(page, "selected")).toHaveCount(1);

  // Esc clears the link's selection, so Interact starts with nothing selected.
  await page.keyboard.press("Escape");
  await expect(outline(page, "selected")).toHaveCount(0);
  await modeButton(page, "Interact").click();
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "true");
  await expect(outline(page, "hover")).toHaveCount(0);
  await expect(outline(page, "selected")).toHaveCount(0);
  await heading(page).click();
  await expect(outline(page, "selected")).toHaveCount(0);
  await expect(editor(page).getByTestId("design-empty")).toContainText("Switch to Edit (V) to select in the page.");
});
