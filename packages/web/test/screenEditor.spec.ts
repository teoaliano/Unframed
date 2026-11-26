import type { Page } from "@playwright/test";
import { SCREEN_EDIT_NOTE } from "@unframed/domain";
import { centre, shapeOnScreen } from "./canvas.ts";
import { promptBox } from "./agent.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putShapes, screenShapes, withRepository } from "./screenHarness.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const editor = (page: Page) => page.getByTestId("artifact-editor");
const centreColumn = (page: Page) => editor(page).locator('[data-editor-column="centre"]');
const panels = (page: Page) => editor(page).locator('[data-editor-column="parameters"]');
const rail = (page: Page) => editor(page).locator('[data-editor-column="rail"]');
const preview = (page: Page) => editor(page).getByTestId("screen-preview");
const app = (page: Page) => preview(page).frameLocator("iframe[data-screen-frame]");
const editorTab = (page: Page) => page.locator("[data-slot=top-bar] [role=tab][data-variant='secondary']");
const modeButton = (page: Page, name: "Edit" | "Interact") => centreColumn(page).getByRole("group", { name: "Mode" }).getByRole("button", { name, exact: true });

const onRoute = async (engine: TestEngine, project: string, route: string) => {
  const [first] = await screenShapes(engine, project);
  await putShapes(engine, project, [{ ...first, props: { ...first.props, route } }]);
  return first as { id: string; props: { title: string } };
};

const openFromToolbar = async (page: Page, id: string) => {
  await clickShape(page, id);
  await expect(page.locator("[data-testid=screen]")).toHaveAttribute("data-painted", "true", { timeout: 30_000 });
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await expect(editor(page)).toBeVisible();
};

test("a Screen opens in the editor from its toolbar and by double-click, live through the proxy, and its tab comes back after a reload", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const first = await onRoute(engine, project, "/app");
    const title = `${first.props.title} · /app`;
    await openFromToolbar(page, first.id);
    await expect(centreColumn(page).getByTestId("artifact-editor-title")).toHaveText(title);
    await expect(centreColumn(page).getByTestId("artifact-editor-kind")).toHaveText("screen");
    await expect(app(page).getByRole("heading", { name: "Fake app" })).toBeVisible({ timeout: 30_000 });
    await expect(preview(page)).toHaveAttribute("data-painted", "true");
    await expect(editorTab(page)).toHaveText(title);
    await expect(rail(page).getByRole("heading", { name: "Agent" })).toBeVisible();

    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 20_000 });
    await expect(app(page).getByRole("heading", { name: "Fake app" })).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    const at = await centre(shapeOnScreen(page, first.id));
    await page.mouse.dblclick(at.x, at.y);
    await expect(editor(page)).toBeVisible();
    await expect(centreColumn(page).getByTestId("artifact-editor-title")).toHaveText(title);
  });
});

test("a Screen's editor header has its chrome and none of a page's own actions, and its preview size is the Screen's viewport", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const first = await onRoute(engine, project, "/app");
    await openFromToolbar(page, first.id);
    const header = centreColumn(page);
    await expect(header.getByRole("group", { name: "Mode" })).toBeVisible();
    await expect(header.getByTestId("screen-branch")).toContainText(first.props.title);
    await expect(header.getByRole("button", { name: "Open in browser" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Open in a new tab" })).toHaveCount(0);
    await expect(header.getByRole("button", { name: /Render/ })).toHaveCount(0);
    await expect(header.getByRole("button", { name: "Component updates available" })).toHaveCount(0);
    await expect(header.getByTestId("preview-size")).toContainText("Desktop 1280");

    await header.getByTestId("screen-branch").click();
    await expect(page.getByRole("menuitem", { name: /Changes/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Another view of this branch" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await header.getByTestId("preview-size").click();
    await page.getByRole("radio", { name: "Phone 390" }).click();
    await expect.poll(async () => (await screenShapes(engine, project))[0].props).toMatchObject({ w: 390, h: 844 });
    await expect(header.getByTestId("preview-size")).toContainText("Phone 390");

    const popup = page.waitForEvent("popup");
    await header.getByRole("button", { name: "Open in browser" }).click();
    expect((await popup).url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/app$/);
  });
});

test("navigating in Interact mode moves the Screen and its tab title follows; deleting the Screen closes its editor", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const first = await onRoute(engine, project, "/app");
    await openFromToolbar(page, first.id);
    await modeButton(page, "Interact").click();
    await app(page).getByRole("link", { name: "About" }).dispatchEvent("click");
    await expect.poll(async () => (await screenShapes(engine, project))[0].props.route).toBe("/app/about");
    await expect(editorTab(page)).toHaveText(`${first.props.title} · /app/about`);
    await expect(preview(page)).toHaveAttribute("data-route", "/app/about");

    const [shape] = await screenShapes(engine, project);
    const rpc = await engine.rpc();
    await rpc.call("testCanvas.apply", { project, change: { put: [], remove: [shape.id] }, origin: { kind: "server", id: "test" } });
    await rpc.close();
    await expect(editor(page)).toHaveCount(0);
    await expect(editorTab(page)).toHaveCount(0);
  });
});

test("Edit mode selects an element in the live app; a Design change previews at once and fills the draft, and undo takes it back out", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const first = await onRoute(engine, project, "/app");
    await openFromToolbar(page, first.id);
    await expect(app(page).getByRole("heading", { name: "Fake app" })).toBeVisible({ timeout: 30_000 });
    await expect(modeButton(page, "Edit")).toHaveAttribute("aria-pressed", "true");
    await expect(panels(page).getByTestId("screen-edit-note")).toHaveText(SCREEN_EDIT_NOTE);

    await expect(async () => {
      await app(page).getByRole("heading", { name: "Fake app" }).dispatchEvent("click");
      await expect(page.locator('[data-edit-outline="selected"]')).toHaveCount(1, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    const size = panels(page).getByRole("spinbutton", { name: "Size", exact: true });
    await expect(size).toBeEnabled();
    await size.fill("48");
    await size.press("Enter");
    await expect(app(page).getByRole("heading", { name: "Fake app" })).toHaveCSS("font-size", "48px");
    await expect(promptBox(rail(page))).toContainText(`Make these changes in the app shown by the Screen ${first.id.replace(/^shape:/, "")}`);
    await expect(promptBox(rail(page))).toContainText("- Fake app (body > h1): font-size: 48px");
    await expect(rail(page).getByText("h1 · Fake app", { exact: true })).toBeVisible();

    await centreColumn(page).getByTestId("artifact-editor-title").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(app(page).getByRole("heading", { name: "Fake app" })).not.toHaveCSS("font-size", "48px");
    await expect(promptBox(rail(page))).not.toContainText("Make these changes");
    await expect(rail(page).getByText("h1 · Fake app", { exact: true })).toHaveCount(0);
    expect((await screenShapes(engine, project))[0].props).not.toHaveProperty("lockedElements");
  });
});

test("a reload of the Screen drops its overrides but keeps the draft, and the next change does not take the earlier one out", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const first = await onRoute(engine, project, "/app");
    await openFromToolbar(page, first.id);
    const heading = app(page).getByRole("heading", { name: "Fake app" });
    await expect(heading).toBeVisible({ timeout: 30_000 });
    const resize = async (value: string) => {
      await expect(async () => {
        await heading.dispatchEvent("click");
        await expect(page.locator('[data-edit-outline="selected"]')).toHaveCount(1, { timeout: 1000 });
      }).toPass({ timeout: 20_000 });
      const size = panels(page).getByRole("spinbutton", { name: "Size", exact: true });
      await expect(size).toBeEnabled();
      await size.fill(value);
      await size.press("Enter");
      await expect(heading).toHaveCSS("font-size", `${value}px`);
    };

    await resize("48");
    await expect(promptBox(rail(page))).toContainText("- Fake app (body > h1): font-size: 48px");

    await preview(page).locator("iframe[data-screen-frame]").evaluate((frame: HTMLIFrameElement) => {
      frame.src = frame.src;
    });
    await expect(heading).not.toHaveCSS("font-size", "48px", { timeout: 30_000 });
    await expect(promptBox(rail(page))).toContainText("- Fake app (body > h1): font-size: 48px");

    await resize("30");
    await expect(promptBox(rail(page))).toContainText("- Fake app (body > h1): font-size: 48px");
    await expect(rail(page).getByText("h1 · Fake app", { exact: true })).toBeVisible();
  });
});

test("Layers lists the live page's elements, with no lock or rename, and hiding one previews and says so in the draft", async ({ page }) => {
  await withRepository(page, {}, async (engine, project) => {
    const first = await onRoute(engine, project, "/app");
    await openFromToolbar(page, first.id);
    await expect(app(page).getByRole("heading", { name: "Fake app" })).toBeVisible({ timeout: 30_000 });
    await panels(page).getByRole("tab", { name: "Layers" }).click();
    await expect(panels(page).getByTestId("screen-edit-note")).toHaveText(SCREEN_EDIT_NOTE);
    const layers = panels(page).getByRole("list", { name: "Layers" });
    await expect(layers.locator("[data-layer]", { hasText: "menu-button" })).toBeVisible({ timeout: 20_000 });
    await expect(layers.getByRole("button", { name: /^Locked / })).toHaveCount(0);
    await layers.getByRole("button", { name: "Hidden menu-button" }).click();
    await expect(app(page).locator("#menu-button")).toBeHidden();
    await expect(promptBox(rail(page))).toContainText("- menu-button (#menu-button): hidden");
  });
});
