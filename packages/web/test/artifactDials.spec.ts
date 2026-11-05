import { readFile } from "node:fs/promises";
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { addParameterInstruction, applyParametersInstruction, BRIDGE_TAG } from "@unframed/domain";
import { connectTab } from "../../engine/test/syncClient.ts";
import { centre, openCanvas, roomRecords, settledRecord, shapeOnScreen } from "./canvas.ts";
import { engineChats, expect, test, userTexts } from "./agent.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { dialsPage, filledArtifact, insideComposition, insideFrame, projectPath, writeBridge, writeProjectFile } from "./artifacts.ts";
import { expectToken, inBothSchemes, styleOf } from "./kit.ts";
import { editor } from "./editorHarness.ts";

const editorFrame = (page: Page): FrameLocator => editor(page).frameLocator("iframe[data-artifact-frame]");
const shown = async (frame: FrameLocator) => JSON.parse((await frame.locator("#values").textContent()) ?? "null");

const openEditor = async (page: Page, id: string, name: string) => {
  const at = await centre(shapeOnScreen(page, id));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: `Editing ${name}` })).toBeVisible();
  await editor(page).locator('[data-editor-column="parameters"]').getByRole("tab", { name: "Parameters" }).click();
};

const dialsOf = async (engine: Parameters<typeof roomRecords>[0], id: string) => (await roomRecords(engine, "default")).find((record) => record.id === id)?.props.dials;

test("an artifact that declares parameters shows them as DialKit controls; one that declares none says so", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ accent: "#a78bfa", size: [12, 8, 40], caption: "Hello", scene: { speed: [1, 0, 5] } }) });
  await filledArtifact(agent, { id: "shape:plain", kind: "page", ref: "151", at: { x: -520, y: 260 }, size: { w: 300, h: 200 }, title: "Plain", html: "<h1>No parameters here</h1>" });
  await expect(shapeOnScreen(page, "shape:plain")).toBeVisible();

  await openEditor(page, "shape:tuned", "Tuned");
  const dials = editor(page).getByTestId("artifact-dials");
  await expect(dials.locator(".dialkit-folder-title-root")).toHaveText("Look");
  await expect(dials.getByRole("slider", { name: "Size" })).toHaveAttribute("aria-valuenow", "12");
  await expect(dials.getByLabel("Accent color value")).toHaveValue("#a78bfa");
  await expect(dials.getByText("Caption")).toBeVisible();
  await expect(dials.getByText("Scene")).toBeVisible();
  await expect(editor(page).getByRole("textbox", { name: "Add a parameter" })).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Add a parameter" }).click();
  await expect(editor(page).getByRole("textbox", { name: "Add a parameter" })).toHaveAttribute("placeholder", "Add a parameter… (e.g. the background colour, the title size)");
  await expect(dials.locator(".dialkit-folder-title-root")).toBeVisible();
  await expect(editor(page).getByRole("textbox", { name: "Add a parameter" })).toBeVisible();
  const lefts = await Promise.all([
    dials.locator(".dialkit-folder-title-root").boundingBox(),
    editor(page).getByRole("textbox", { name: "Add a parameter" }).boundingBox(),
  ]);
  const [title, box] = lefts.map((each) => Math.round(each!.x));
  expect(Math.abs(box! - title!)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(editor(page).getByRole("button", { name: "Add a parameter" })).toBeFocused();
  await editor(page).getByRole("button", { name: "Back to canvas" }).click();

  await page.mouse.click(640, 600);
  await openEditor(page, "shape:plain", "Plain");
  await expect(editorFrame(page).getByRole("heading", { name: "No parameters here" })).toBeVisible();
  await expect(editor(page).getByText("No parameters yet.")).toBeVisible();
  await expect(editor(page).getByTestId("artifact-dials")).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Add a parameter" }).click();
  await expect(editor(page).getByRole("textbox", { name: "Add a parameter" })).toHaveAttribute("placeholder", "Describe a parameter… (e.g. the accent colour and the intro speed)");
});

test("dragging a dial moves the frame live and writes the values once it settles, one undo step that Cmd-Z on the canvas takes back", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100] }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await openEditor(page, "shape:tuned", "Tuned");
  await expect.poll(() => shown(editorFrame(page))).toEqual({ size: 10 });

  const slider = editor(page).getByRole("slider", { name: "Size" });
  await expect(slider).toBeVisible();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(box.x + box.width * (0.1 + step * 0.05), box.y + box.height / 2);
    await page.waitForTimeout(30);
  }
  await expect.poll(async () => (await shown(editorFrame(page))).size).toBeGreaterThan(50);
  await page.mouse.up();
  const dragged = Number(await slider.getAttribute("aria-valuenow"));
  expect(dragged).toBeGreaterThan(50);
  await expect.poll(async () => (await shown(editorFrame(page))).size).toBe(dragged);
  await expect.poll(() => dialsOf(agent, "shape:tuned"), { timeout: 10_000 }).toEqual({ size: dragged });

  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await settledRecord(agent, "default", "shape:tuned"))?.props.dials).toBeUndefined();
});

test("a change made just before the editor closes is still saved", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100, 1] }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await openEditor(page, "shape:tuned", "Tuned");
  const slider = editor(page).getByRole("slider", { name: "Size" });
  await expect(slider).toHaveAttribute("aria-valuenow", "10");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await editor(page).getByRole("button", { name: "Back to canvas" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(() => dialsOf(agent, "shape:tuned"), { timeout: 10_000 }).toEqual({ size: 13 });
});

const DIALS_MOTION = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;overflow:hidden;background:#000;color:#fff}.clip{position:absolute;inset:0}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="3" data-width="640" data-height="360"><div id="c" class="clip" data-start="0" data-duration="3"><pre id="values">none</pre></div></div>
<script src="gsap.js"></script>
<script>
window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true });
unframed.dials("Scene", { accent: "#a78bfa", speed: [1, 0, 5] }, function (v) { document.getElementById("values").textContent = JSON.stringify(v); });
</script></body></html>`;

test("saved values show in canvas frames of pages and motions, and a change from another tab reaches this tab's frame", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ accent: "#a78bfa", size: [12, 8, 40] }), dials: { accent: "#ff0000", size: 30 } });
  await filledArtifact(agent, { id: "shape:intro", kind: "motion", ref: "151", at: { x: -520, y: 260 }, size: { w: 320, h: 180 }, title: "Intro", html: DIALS_MOTION, dials: { speed: 2.5 } });
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();

  await clickShape(page, "shape:tuned");
  await expect.poll(() => shown(insideFrame(page, "shape:tuned")), { timeout: 10_000 }).toEqual({ accent: "#ff0000", size: 30 });
  await clickShape(page, "shape:intro");
  await expect.poll(() => shown(insideComposition(insideFrame(page, "shape:intro"))), { timeout: 15_000 }).toEqual({ accent: "#a78bfa", speed: 2.5 });

  const tab = await connectTab(agent.port, "default");
  await tab.loaded;
  const current = tab.get("shape:intro");
  await tab.put([{ ...current, props: { ...current.props, dials: { speed: 4, accent: "#00ff00" } } }]);
  await tab.close();
  await expect.poll(() => shown(insideComposition(insideFrame(page, "shape:intro"))), { timeout: 10_000 }).toEqual({ accent: "#00ff00", speed: 4 });
});

test("a new version that drops or retypes a parameter keeps the rest and rebuilds the panel", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  const { file } = await filledArtifact(agent, {
    id: "shape:tuned",
    kind: "page",
    ref: "150",
    at: { x: -520, y: -40 },
    size: { w: 300, h: 200 },
    title: "Tuned",
    html: dialsPage({ accent: "#a78bfa", size: [12, 8, 40], caption: "Hello" }),
    dials: { accent: "#ff0000", size: 30, caption: "Saved" },
  });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await openEditor(page, "shape:tuned", "Tuned");
  const dials = editor(page).getByTestId("artifact-dials");
  await expect(dials.getByRole("slider", { name: "Size" })).toHaveAttribute("aria-valuenow", "30");
  await expect.poll(() => shown(editorFrame(page))).toEqual({ accent: "#ff0000", size: 30, caption: "Saved" });

  await expect.poll(async () => (await readFile(projectPath(agent, (await roomRecords(agent, "default")).find((item) => item.id === "shape:tuned")!.props.file), "utf8")).includes("data-hf-id"), { timeout: 20_000 }).toBe(true);
  await writeProjectFile(agent, "2-tuned.html", dialsPage({ accent: "#a78bfa", size: "big", glow: true }).replace(BRIDGE_TAG, `${BRIDGE_TAG}<!-- v2 -->`));
  const record = (await roomRecords(agent, "default")).find((item) => item.id === "shape:tuned")!;
  expect(record.props.file).not.toBe(file);
  await putRecords(agent, [{ ...record, props: { ...record.props, file: "2-tuned.html" } }]);

  await expect(dials.getByRole("slider", { name: "Size" })).toHaveCount(0, { timeout: 10_000 });
  await expect(dials.getByText("Glow")).toBeVisible();
  await expect(dials.getByText("Caption")).toHaveCount(0);
  await expect(dials.getByLabel("Accent color value")).toHaveValue("#ff0000");
  await expect.poll(() => shown(editorFrame(page))).toEqual({ accent: "#ff0000", size: "big", glow: true });
});

test("DialKit follows the app's scheme in the kit's tokens, as one card with its column and with the canvas panel", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [12, 8, 40] }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();

  const themed = async (dials: ReturnType<Page["locator"]>, card: ReturnType<Page["locator"]>) => {
    const panel = dials.locator(".dialkit-panel-inner");
    await expect(dials.locator(".dialkit-folder-title-root")).toHaveText("Look");
    await inBothSchemes(page, async (scheme) => {
      await expect(dials.locator(".dialkit-root")).toHaveAttribute("data-theme", scheme);
      await expectToken(panel, "background-color", "--card");
      await expectToken(card, "background-color", "--card");
      await expectToken(dials.locator(".dialkit-slider"), "background-color", "--background");
      await expectToken(dials.locator(".dialkit-slider"), "border-top-color", "--input");
      await expectToken(dials.locator(".dialkit-folder-title-root"), "color", "--foreground");
      await expectToken(dials.locator(".dialkit-slider-label"), "color", "--muted-foreground");
      expect(await styleOf(panel, "font-family")).toBe(await styleOf(page.locator("body"), "font-family"));
      expect(await styleOf(dials.locator(".dialkit-slider-label"), "font-size")).toBe("14px");
      expect(await styleOf(dials.locator(".dialkit-slider-label"), "font-family")).toBe(await styleOf(page.locator("body"), "font-family"));
      expect(await styleOf(dials.locator(".dialkit-slider-value"), "font-family")).toMatch(/mono/i);
    });
  };

  await clickShape(page, "shape:tuned");
  await parametersToggle(page).click();
  const canvas = canvasPanel(page, "Tuned");
  await themed(canvas.getByTestId("artifact-dials"), canvas);
  await page.keyboard.press("Escape");

  await page.mouse.click(640, 600);
  await openEditor(page, "shape:tuned", "Tuned");
  await themed(editor(page).getByTestId("artifact-dials"), editor(page).locator('[data-editor-column="parameters"]'));
});

const dialKitLoaded = (page: Page) =>
  page.evaluate(() =>
    [...document.styleSheets].some((sheet) => {
      try {
        return [...sheet.cssRules].some((rule) => rule.cssText.includes(".dialkit-button-group"));
      } catch {
        return false;
      }
    }),
  );

const parametersToggle = (page: Page) => page.getByTestId("selection-toolbar").getByRole("button", { name: "Parameters" });
const canvasPanel = (page: Page, title: string) => page.getByRole("region", { name: `Parameters for ${title}` });

test("Parameters on a selected page opens its dials beside it on the canvas: they drive the live frame and save as one undo step", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100, 1] }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();

  await clickShape(page, "shape:tuned");
  await expect.poll(() => shown(insideFrame(page, "shape:tuned")), { timeout: 10_000 }).toEqual({ size: 10 });
  expect(await dialKitLoaded(page)).toBe(false);
  await expect(parametersToggle(page)).toHaveAttribute("aria-pressed", "false");
  await parametersToggle(page).click();
  const panel = canvasPanel(page, "Tuned");
  await expect(panel).toBeVisible();
  await expect(parametersToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toHaveCount(0);
  expect(await dialKitLoaded(page)).toBe(true);
  await expect(panel.locator("header")).toHaveText("Parameters");
  const shapeBox = (await shapeOnScreen(page, "shape:tuned").boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.x).toBeGreaterThanOrEqual(shapeBox.x + shapeBox.width);

  const slider = panel.getByRole("slider", { name: "Size" });
  await expect(slider).toHaveAttribute("aria-valuenow", "10");
  const before = (await roomRecords(agent, "default")).find((record) => record.id === "shape:tuned")!;
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => shown(insideFrame(page, "shape:tuned"))).toEqual({ size: 13 });
  await expect.poll(() => dialsOf(agent, "shape:tuned"), { timeout: 10_000 }).toEqual({ size: 13 });
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  const after = (await roomRecords(agent, "default")).find((record) => record.id === "shape:tuned");
  expect(after).toBeDefined();
  expect({ x: after!.x, y: after!.y }).toEqual({ x: before.x, y: before.y });

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(parametersToggle(page)).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await settledRecord(agent, "default", "shape:tuned"))?.props.dials).toBeUndefined();
  await expect.poll(() => shown(insideFrame(page, "shape:tuned"))).toEqual({ size: 10 });
});

test("the canvas panel saves a change made just before it closes, shows one artifact at a time, and keeps its artifact live", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100, 1] }) });
  await filledArtifact(agent, { id: "shape:intro", kind: "motion", ref: "151", at: { x: -520, y: 260 }, size: { w: 320, h: 180 }, title: "Intro", html: DIALS_MOTION });
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();

  await clickShape(page, "shape:tuned");
  await parametersToggle(page).click();
  const tuned = canvasPanel(page, "Tuned");
  const slider = tuned.getByRole("slider", { name: "Size" });
  await expect(slider).toHaveAttribute("aria-valuenow", "10");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await tuned.getByRole("button", { name: "Close parameters" }).click();
  await expect(tuned).toHaveCount(0);
  await expect.poll(() => dialsOf(agent, "shape:tuned"), { timeout: 10_000 }).toEqual({ size: 12 });

  await parametersToggle(page).click();
  await expect(tuned.getByRole("slider", { name: "Size" })).toHaveAttribute("aria-valuenow", "12");
  await clickShape(page, "shape:intro");
  await expect(tuned).toHaveCount(0);
  await parametersToggle(page).click();
  const intro = canvasPanel(page, "Intro");
  const speed = intro.getByRole("slider", { name: "Speed" });
  await expect(speed).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: /^Parameters for / })).toHaveCount(1);
  await speed.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await shown(insideComposition(insideFrame(page, "shape:intro")))).speed, { timeout: 10_000 }).toBeGreaterThan(1);

  const width = page.viewportSize()!.width;
  await page.mouse.move(200, 600);
  for (let step = 0; step < 30; step++) {
    await page.mouse.wheel(width / 10, 0);
    await page.waitForTimeout(16);
  }
  await expect(intro).toBeVisible();
  await expect(shapeOnScreen(page, "shape:intro").locator("iframe[data-artifact-frame]")).toHaveCount(1);
  for (let step = 0; step < 30; step++) {
    await page.mouse.wheel(-width / 10, 0);
    await page.waitForTimeout(16);
  }

  await page.getByTestId("selection-toolbar").getByRole("button", { name: "Editor", exact: true }).click();
  await expect(page.getByRole("region", { name: "Editing Intro" })).toBeVisible();
  await expect(intro).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await expect(intro).toHaveCount(0);
  await parametersToggle(page).click();
  await expect(intro).toBeVisible();
  const panelBox = (await intro.boundingBox())!;
  await page.mouse.click(panelBox.x + panelBox.width + 120, panelBox.y + 40);
  await expect(intro).toHaveCount(0);
});

test("a page with no parameters opens a panel that asks the agent for one, in the page's own chat", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:plain", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Plain", html: "<h1>No parameters here</h1>" });
  await expect(shapeOnScreen(page, "shape:plain")).toBeVisible();
  await clickShape(page, "shape:plain");
  await expect(insideFrame(page, "shape:plain").getByRole("heading", { name: "No parameters here" })).toBeVisible();
  await parametersToggle(page).click();
  const panel = canvasPanel(page, "Plain");
  await expect(panel.getByText("No parameters yet.")).toBeVisible();
  const box = panel.getByRole("textbox", { name: "Add a parameter" });
  await expect(box).toHaveCount(0);
  await panel.getByRole("button", { name: "Add a parameter" }).click();
  await expect(box).toHaveAttribute("placeholder", "Describe a parameter… (e.g. the accent colour and the intro speed)");
  await expect(panel.getByText("The agent writes it")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await box.fill("the background colourx");
  await page.keyboard.press("Backspace");
  await expect(box).toHaveValue("the background colour");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(box).toHaveCount(0, { timeout: 10_000 });
  const [chat] = await engineChats(agent);
  expect(chat?.tags).toEqual(["shape:plain"]);
  expect(await userTexts(agent, chat!.id)).toEqual([addParameterInstruction({ wanted: "the background colour", kind: "page", title: "Plain" })]);
  await expect(page.getByRole("complementary", { name: "Agent" })).toBeVisible();
});

const PANEL_FIT_DIALS = `<!doctype html><html><head><style>body{margin:0;font:14px sans-serif}</style>${BRIDGE_TAG}</head><body><pre id="values">none</pre>
<script>
unframed.dials("Blueprint loader", {
  speed: [1.5, 0, 4, 0.1],
  wire: [40, 0, 100],
  component: "Loader",
  sizes: { width: [320, 100, 800], height: [180, 50, 600] },
  version: ["v1", "v2", "v3"],
  accent: "#a78bfa",
  scrub: { on: true, time: [0.5, 0, 5, 0.01] },
  caption: "A considerably longer caption than the panel is wide, which must wrap or truncate rather than widen it",
}, function (v) { document.getElementById("values").textContent = JSON.stringify(v); });
</script></body></html>`;

test("the Parameters panel fits its width: nothing in it scrolls sideways, in either scheme", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: PANEL_FIT_DIALS });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await clickShape(page, "shape:tuned");
  await parametersToggle(page).click();
  const panel = canvasPanel(page, "Tuned");
  await expect(panel.getByRole("slider", { name: "Speed" })).toBeVisible();
  const scroller = panel.locator('[data-scrolls="true"]');
  await inBothSchemes(page, async () => {
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const widths = await scroller.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });
});

const EDGES_DIALS = `<!doctype html><html><head><style>body{margin:0;font:14px sans-serif}</style>${BRIDGE_TAG}</head><body><pre id="values">none</pre>
<script>
unframed.dials("Blueprint loader", { edges: { radius: [14, 0, 40], inset: [4, 0, 20] }, speed: [1.5, 0, 4, 0.1] }, function (v) { document.getElementById("values").textContent = JSON.stringify(v); });
</script></body></html>`;

test("a slider's label stays readable while it is hovered and while it is dragged", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: EDGES_DIALS });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await clickShape(page, "shape:tuned");
  await parametersToggle(page).click();
  const panel = canvasPanel(page, "Tuned");
  const slider = panel.getByRole("slider", { name: "Radius" });
  await expect(slider).toBeVisible();
  const row = panel.locator(".dialkit-slider").first();
  const contrast = () =>
    row.evaluate((element) => {
      const paint = (over: string, under: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.fillStyle = under;
        context.fillRect(0, 0, 1, 1);
        context.fillStyle = over;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((channel) => {
          const c = channel / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      };
      const luminance = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const surface = getComputedStyle(element).backgroundColor;
      const fill = element.querySelector<HTMLElement>(".dialkit-slider-fill")!;
      const fillColour = getComputedStyle(fill).backgroundColor;
      const fillEnd = fill.getBoundingClientRect().right;
      const backdropUnder = (part: Element) => {
        const box = part.getBoundingClientRect();
        return box.left + box.width / 2 < fillEnd ? paint(fillColour, surface) : paint(surface, surface);
      };
      const pair = (part: Element) => ratio(luminance(paint(getComputedStyle(part).color, "#000")), luminance(backdropUnder(part)));
      return pair(element.querySelector(".dialkit-slider-label")!);
    });
  await inBothSchemes(page, async () => {
    await row.hover();
    await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
    await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
    await page.mouse.up();
    await page.mouse.move(0, 0);
  });
});

test("on the canvas panel, Apply sends the current values to the artifact's chat and opens the rail on it, and the folded box opens below the header", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [12, 8, 40], scene: { speed: [1, 0, 5] } }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await clickShape(page, "shape:tuned");
  await parametersToggle(page).click();
  const panel = canvasPanel(page, "Tuned");
  await expect(panel.getByTestId("artifact-dials").locator(".dialkit-folder-title-root")).toHaveText("Look");
  await expect(panel.getByRole("textbox", { name: "Add a parameter" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Add a parameter" }).click();
  await expect(panel.getByRole("textbox", { name: "Add a parameter" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("textbox", { name: "Add a parameter" })).toHaveCount(0);
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 10_000 });
  const [chat] = await engineChats(agent);
  expect(chat?.tags).toEqual(["shape:tuned"]);
  expect(await userTexts(agent, chat!.id)).toEqual([applyParametersInstruction({ name: "Look", kind: "page", title: "Tuned", values: { size: 12, scene: { speed: 1 } } })]);
  await expect(page.getByRole("complementary", { name: "Agent" })).toBeVisible();
});

test("a parameter's description shows in a kit tooltip over its label, on the canvas panel and in the editor; one without a description shows none", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  const config = { size: { value: [12, 8, 40], description: "The title's size in pixels" }, scene: { value: { speed: { value: [1, 0, 5], description: "How fast the intro plays" } }, description: "The opening scene" }, caption: "Hello" };
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage(config) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await clickShape(page, "shape:tuned");
  await parametersToggle(page).click();
  const panel = canvasPanel(page, "Tuned");
  const tip = page.getByTestId("parameter-description");
  const hoverLabel = async (scope: Locator, text: string) => {
    const box = (await scope.getByTestId("artifact-dials").getByText(text, { exact: true }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };
  await expect(panel.getByRole("slider", { name: "Size" })).toHaveAttribute("aria-description", "The title's size in pixels");
  await hoverLabel(panel, "Size");
  await expect(tip).toHaveText("The title's size in pixels");
  await expect(tip).toHaveAttribute("data-slot", "tooltip-popup");
  const [label, popup] = [(await panel.getByText("Size", { exact: true }).boundingBox())!, (await tip.boundingBox())!];
  expect(popup.y + popup.height).toBeLessThanOrEqual(label.y + 1);
  await hoverLabel(panel, "Speed");
  await expect(tip).toHaveText("How fast the intro plays");
  await hoverLabel(panel, "Scene");
  await expect(tip).toHaveText("The opening scene");
  await hoverLabel(panel, "Caption");
  await page.waitForTimeout(700);
  await expect(tip).toHaveCount(0);
  await page.mouse.move(1200, 700);
  await expect(tip).toHaveCount(0);

  await page.keyboard.press("Escape");
  await openEditor(page, "shape:tuned", "Tuned");
  await hoverLabel(editor(page), "Speed");
  await expect(tip).toHaveText("How fast the intro plays");
});
