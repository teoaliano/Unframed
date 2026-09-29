import type { Page } from "@playwright/test";
import { centre, openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { putRecords } from "./media.ts";
import { artifactShape, filledArtifact } from "./artifacts.ts";
import { connectTab } from "../../engine/test/syncClient.ts";

const editor = (page: Page) => page.locator(".unframed-artifact-editor");

const onBoard = async (page: Page, engine: Parameters<typeof openCanvas>[1]) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: "<h1>Welcome</h1>" });
  await putRecords(engine, [artifactShape({ id: "shape:draft", kind: "motion", ref: "151", at: { x: -520, y: 300 }, size: { w: 300, h: 180 } })]);
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:draft")).toBeVisible();
};

test("double-click opens the editor: rail, live frame and parameters, with Back and Esc restoring the camera", async ({ page, agent }) => {
  await onBoard(page, agent);
  const before = await shapeOnScreen(page, "shape:landing").boundingBox();
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);

  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();
  await expect(editor(page).locator(".unframed-artifact-editor__column")).toHaveCount(3);
  await expect(editor(page).locator(".unframed-artifact-editor__rail").getByRole("complementary", { name: "Agent" })).toBeVisible();
  await expect(editor(page).locator(".unframed-artifact-editor__rail").getByRole("button", { name: "Close" })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Back to canvas" })).toBeVisible();
  await expect(region.locator(".unframed-artifact-editor__title")).toHaveText("Landing");
  await expect(region.locator(".unframed-artifact-editor__kind")).toHaveText("page");
  await expect(region.getByRole("button", { name: "Open in a new tab" })).toBeVisible();
  const frame = region.locator("iframe.unframed-artifact__frame");
  await expect(frame).not.toHaveAttribute("loading", "lazy");
  await expect(region.frameLocator("iframe.unframed-artifact__frame").getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(editor(page).locator(".unframed-artifact-editor__parameters")).toContainText("Parameters");
  // The canvas's own frames unload while the editor is open.
  await expect(shapeOnScreen(page, "shape:landing").locator("iframe")).toHaveCount(0);
  // tldraw's watermark stays visible below the editor.
  await expect(page.locator(".tl-watermark_SEE-LICENSE")).toBeVisible();

  await region.getByRole("button", { name: "Back to canvas" }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await shapeOnScreen(page, "shape:landing").boundingBox()).toEqual(before);
  // The double-click opened the editor and nothing else: no prompt where it landed.
  expect((await roomRecords(agent, "default")).filter((record) => record.type === "text")).toHaveLength(2);

  // Deselect and pan away (a selected artifact's frame takes a double-click as its own), open again, and Escape comes back to exactly where it was.
  await page.mouse.click(640, 560);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(120, 60);
  await page.waitForTimeout(300);
  const moved = await shapeOnScreen(page, "shape:landing").boundingBox();
  const again = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(again.x, again.y);
  await expect(region).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  expect(await shapeOnScreen(page, "shape:landing").boundingBox()).toEqual(moved);
});

test("Escape typed in the composer or the parameter box stays in the editor, and canvas shortcuts do nothing while it is open", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();

  await editor(page).getByRole("textbox", { name: "Message the agent" }).click();
  await page.keyboard.press("Escape");
  await expect(region).toBeVisible();
  await editor(page).getByRole("textbox", { name: "Add a parameter" }).click();
  await page.keyboard.press("Escape");
  await expect(region).toBeVisible();

  // Focus on the editor's own controls: Delete, Backspace and tool keys reach no canvas shortcut.
  await region.getByRole("button", { name: "Back to canvas" }).focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("r");
  await page.keyboard.press("Shift+P");
  await page.waitForTimeout(300);
  expect((await roomRecords(agent, "default")).some((record) => record.id === "shape:landing")).toBe(true);
  expect((await roomRecords(agent, "default")).filter((record) => record.type === "page")).toHaveLength(1);
  // The first Escape closes the Back button's tooltip; the next closes the editor.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(region).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select — V" })).toHaveAttribute("aria-pressed", "true");
});

test("an artifact with no file says so and offers no new tab; Open in a new tab opens the artifact's URL", async ({ page, agent }) => {
  await onBoard(page, agent);
  const empty = await centre(shapeOnScreen(page, "shape:draft"));
  await page.mouse.dblclick(empty.x, empty.y - 30);
  const region = page.getByRole("region", { name: "Editing draft" });
  await expect(region).toBeVisible();
  await expect(region.locator(".unframed-artifact-editor__kind")).toHaveText("motion");
  await expect(region.getByText("This motion has no file yet. Ask the agent to write one.")).toBeVisible();
  await expect(region.getByRole("button", { name: "Open in a new tab" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const landing = page.getByRole("region", { name: "Editing Landing" });
  const file = (await roomRecords(agent, "default")).find((record) => record.id === "shape:landing")!.props.file as string;
  const opened = page.context().waitForEvent("page");
  await landing.getByRole("button", { name: "Open in a new tab" }).click();
  const tab = await opened;
  await tab.waitForLoadState();
  // The app is on localhost, so the artifact is on the other loopback name.
  expect(tab.url()).toBe(`http://127.0.0.1:${agent.previewPort}/p/default/${file}`);
  await expect(tab.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await tab.close();
});

test("deleting the artifact from another tab closes the editor", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();

  // Another tab's delete reaches this one as a remote change of the room, as this one does.
  const tab = await connectTab(agent.port, "default");
  await tab.loaded;
  await tab.remove(["shape:landing"]);
  await tab.close();
  await expect(editor(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(shapeOnScreen(page, "shape:landing")).toHaveCount(0);
});
