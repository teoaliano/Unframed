import type { Page } from "@playwright/test";
import { centre, openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { putRecords } from "./media.ts";
import { artifactShape, filledArtifact } from "./artifacts.ts";
import { connectTab } from "../../engine/test/syncClient.ts";
import { expectSlot, expectToken, inBothSchemes, styleOf } from "./kit.ts";

const editor = (page: Page) => page.getByTestId("artifact-editor");
const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);

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
  await expect(editor(page).locator("[data-editor-column]")).toHaveCount(3);
  await expect(column(page, "rail").getByRole("complementary", { name: "Agent" })).toBeVisible();
  await expect(column(page, "rail").getByRole("button", { name: "Close" })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Back to canvas" })).toBeVisible();
  await expect(region.getByTestId("artifact-editor-title")).toHaveText("Landing");
  await expect(region.getByTestId("artifact-editor-kind")).toHaveText("page");
  await expect(region.getByRole("button", { name: "Open in a new tab" })).toBeVisible();
  const frame = region.locator("iframe[data-artifact-frame]");
  await expect(frame).not.toHaveAttribute("loading", "lazy");
  await expect(region.frameLocator("iframe[data-artifact-frame]").getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(column(page, "parameters")).toContainText("Parameters");
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
  await expect(region.getByTestId("artifact-editor-kind")).toHaveText("motion");
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

test("the editor's columns, header actions and parameter box are the kit's, in both schemes", async ({ page, agent }) => {
  await onBoard(page, agent);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  const region = page.getByRole("region", { name: "Editing Landing" });
  await expect(region).toBeVisible();
  // The grid stays 360, flexible, 320, with 12 px gaps and padding.
  expect((await column(page, "rail").boundingBox())!.width).toBe(360);
  expect((await column(page, "parameters").boundingBox())!.width).toBe(320);
  const [rail, centreColumn] = [(await column(page, "rail").boundingBox())!, (await column(page, "centre").boundingBox())!];
  expect(centreColumn.x - (rail.x + rail.width)).toBe(12);
  expect(rail.x).toBe(12);
  // The centre's frame fills the space under the header.
  const frame = (await region.locator("iframe[data-artifact-frame]").boundingBox())!;
  expect(frame.width).toBeGreaterThan(centreColumn.width - 4);
  expect(frame.y + frame.height).toBeGreaterThan(centreColumn.y + centreColumn.height - 4);

  const back = region.getByRole("button", { name: "Back to canvas" });
  const newTab = region.getByRole("button", { name: "Open in a new tab" });
  const box = editor(page).getByRole("textbox", { name: "Add a parameter" });
  const add = editor(page).getByRole("button", { name: "Add", exact: true });
  await expectSlot(back, "tooltip-trigger");
  await expectSlot(newTab, "tooltip-trigger");
  await expectSlot(box, "textarea");
  await expectSlot(add, "button");
  expect((await back.boundingBox())!.height).toBe(32);
  await page.mouse.move(640, 700);
  await inBothSchemes(page, async () => {
    for (const name of ["rail", "centre", "parameters"] as const) {
      await expectToken(column(page, name), "background-color", "--card");
      await expectToken(column(page, name), "border-top-color", "--color-border");
    }
    expect(await styleOf(back, "background-color")).toBe("rgba(0, 0, 0, 0)");
    await expectToken(region.getByTestId("artifact-editor-title"), "color", "--color-foreground");
    await expectToken(region.getByTestId("artifact-editor-kind"), "color", "--color-muted-foreground");
    await expectToken(editor(page).getByText("The agent writes it"), "color", "--color-muted-foreground");
    await expectToken(editor(page), "background-color", "--background");
  });
});

/** A page that shows its own viewport, and a number drawn once per load, so a reload shows. */
const VIEWPORT_PAGE = `<!doctype html><html><body><h1 id="vp"></h1><p id="boot"></p><script>
document.getElementById("boot").textContent = String(Math.random());
const show = () => (document.getElementById("vp").textContent = innerWidth + "x" + innerHeight);
show();
addEventListener("resize", show);
</script></body></html>`;

test("the editor sizes its preview to Fill, Desktop, Tablet, Mobile or a typed size, shrinks it to fit, and remembers it per artifact for the session", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: VIEWPORT_PAGE });
  await filledArtifact(agent, { id: "shape:other", kind: "page", ref: "151", at: { x: -520, y: 300 }, size: { w: 300, h: 180 }, title: "Other", html: VIEWPORT_PAGE });
  await expect(shapeOnScreen(page, "shape:other")).toBeVisible();
  const open = async (id: string, title: string) => {
    await page.mouse.click(640, 600);
    const at = await centre(shapeOnScreen(page, id));
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.getByRole("region", { name: `Editing ${title}` })).toBeVisible();
  };
  const trigger = () => editor(page).getByRole("button", { name: "Preview size" });
  const popup = () => page.getByRole("dialog", { name: "Preview size" });
  const choose = async (label: string) => {
    await trigger().click();
    await popup().getByRole("radio", { name: label }).click();
  };

  await open("shape:landing", "Landing");
  const region = page.getByRole("region", { name: "Editing Landing" });
  const inside = region.frameLocator("iframe[data-artifact-frame]");
  const frame = region.locator("iframe[data-artifact-frame]");
  await expect(trigger()).toContainText("Fill");
  await expect(inside.locator("#vp")).toHaveText(/^\d+x\d+$/);
  const boot = await inside.locator("#boot").textContent();
  const body = (await column(page, "centre").boundingBox())!;

  for (const [label, viewport] of [
    ["Desktop 1440", [1440, 900]],
    ["Tablet 768", [768, 1024]],
    ["Mobile 390", [390, 844]],
  ] as const) {
    await choose(label);
    // A named size closes the popover; reopened, the choice carries the check.
    await expect(popup()).toHaveCount(0);
    await expect(trigger()).toContainText(label);
    await expect(inside.locator("#vp")).toHaveText(`${viewport[0]}x${viewport[1]}`);
    // Shrunk to fit inside the column, its shape kept.
    const box = (await frame.boundingBox())!;
    expect(box.width).toBeLessThan(viewport[0]);
    expect(box.x).toBeGreaterThanOrEqual(body.x);
    expect(box.x + box.width).toBeLessThanOrEqual(body.x + body.width);
    expect(box.y + box.height).toBeLessThanOrEqual(body.y + body.height);
    expect(Math.abs(box.width / box.height - viewport[0] / viewport[1])).toBeLessThan(0.02);
    const scale = Number((await region.getByTestId("artifact-preview-scale").textContent())!.replace("%", ""));
    expect(Math.abs(scale - (box.width / viewport[0]) * 100)).toBeLessThanOrEqual(1);
  }
  await trigger().click();
  await expect(popup().getByRole("radio", { name: "Mobile 390" })).toHaveAttribute("aria-checked", "true");
  await expect(popup().getByRole("radio", { name: "Mobile 390" }).locator("svg")).toHaveCount(1);
  await expect(popup().getByRole("radio", { name: "Fill" }).locator("svg")).toHaveCount(0);

  // A typed size, in the popover: Custom keeps it open; a size that fits shows unscaled.
  await popup().getByRole("radio", { name: "Custom" }).click();
  await expect(popup()).toBeVisible();
  await expect(popup().getByLabel("Preview width")).toBeFocused();
  await popup().getByLabel("Preview width").fill("400");
  await popup().getByLabel("Preview width").press("Enter");
  await popup().getByLabel("Preview height").fill("300");
  await popup().getByLabel("Preview height").press("Enter");
  await expect(inside.locator("#vp")).toHaveText("400x300");
  await expect(trigger()).toContainText("400 × 300");
  await expect.poll(async () => {
    const box = (await frame.boundingBox())!;
    return [Math.round(box.width), Math.round(box.height)];
  }).toEqual([400, 300]);
  await expect(region.getByTestId("artifact-preview-scale")).toHaveCount(0);

  // An emptied side shows the size in use again; a side under 100 px is held at 100.
  await popup().getByLabel("Preview width").fill("");
  await popup().getByLabel("Preview width").press("Enter");
  await expect(popup().getByLabel("Preview width")).toHaveValue("400");
  await expect(inside.locator("#vp")).toHaveText("400x300");
  await popup().getByLabel("Preview height").fill("5");
  await popup().getByLabel("Preview height").press("Enter");
  await expect(popup().getByLabel("Preview height")).toHaveValue("100");
  await expect(inside.locator("#vp")).toHaveText("400x100");
  await popup().getByLabel("Preview height").fill("300");
  await popup().getByLabel("Preview height").press("Enter");
  await expect(inside.locator("#vp")).toHaveText("400x300");
  // Every change resized the same document; none reloaded it.
  await expect(inside.locator("#boot")).toHaveText(boot!);

  // Esc closes the popover and leaves the editor open; the next one closes the editor.
  await page.keyboard.press("Escape");
  await expect(popup()).toHaveCount(0);
  await expect(region).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(region).toHaveCount(0);

  // Remembered for this artifact; another one opens on Fill; nothing is written to the shape.
  await open("shape:landing", "Landing");
  await expect(trigger()).toContainText("400 × 300");
  await expect(inside.locator("#vp")).toHaveText("400x300");
  await page.keyboard.press("Escape");
  await open("shape:other", "Other");
  await expect(trigger()).toContainText("Fill");
  await page.keyboard.press("Escape");
  const record = (await roomRecords(agent, "default")).find((item) => item.id === "shape:landing")!;
  expect(Object.keys(record.props).sort()).toEqual(["fileName", "file", "h", "title", "w"].sort());

  // Session memory only: a reload starts on Fill.
  await page.reload();
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await open("shape:landing", "Landing");
  await expect(trigger()).toContainText("Fill");

  // Back to Fill from a size: the frame takes the column again.
  await choose("Mobile 390");
  await expect(inside.locator("#vp")).toHaveText("390x844");
  await choose("Fill");
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan((await column(page, "centre").boundingBox())!.width - 4);
});

const MOTION = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }) };</script></body></html>`;

test("in a narrow window the editor's header never overflows: the title stays, and every action stays whole", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:intro", kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 320, h: 180 }, title: "A motion with a long title", html: MOTION });
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();
  // The narrow window shows only part of the motion: double-click the middle of what shows.
  const shown = (await shapeOnScreen(page, "shape:intro").boundingBox())!;
  const left = Math.max(shown.x, 0);
  await page.mouse.dblclick((left + Math.min(shown.x + shown.width, 1024)) / 2, shown.y + shown.height / 2);
  const region = page.getByRole("region", { name: "Editing A motion with a long title" });
  await expect(region).toBeVisible();
  const header = region.locator("header").first();

  const whole = async () => {
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = (await header.boundingBox())!;
    const title = (await region.getByTestId("artifact-editor-title").boundingBox())!;
    expect(title.width).toBeGreaterThanOrEqual(40);
    for (const name of ["Back to canvas", "Preview size", "Render", "Open in a new tab"]) {
      const box = (await region.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
  };
  await whole();
  await region.getByRole("button", { name: "Preview size" }).click();
  await page.getByRole("dialog", { name: "Preview size" }).getByRole("radio", { name: "Custom" }).click();
  await page.getByRole("dialog", { name: "Preview size" }).getByLabel("Preview width").fill("1800");
  await page.getByRole("dialog", { name: "Preview size" }).getByLabel("Preview width").press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Preview size" })).toHaveCount(0);
  await whole();
});
