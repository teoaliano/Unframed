import type { FrameLocator, Page } from "@playwright/test";
import { addParameterInstruction, BRIDGE_TAG } from "@unframed/domain";
import { connectTab } from "../../engine/test/syncClient.ts";
import { centre, openCanvas, roomRecords, settledRecord, shapeOnScreen } from "./canvas.ts";
import { engineChats, expect, test, userTexts } from "./agent.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { dialsPage, filledArtifact, insideComposition, insideFrame, writeBridge, writeProjectFile } from "./artifacts.ts";
import { expectToken, inBothSchemes, styleOf } from "./kit.ts";

const editor = (page: Page) => page.getByTestId("artifact-editor");
const editorFrame = (page: Page): FrameLocator => editor(page).frameLocator("iframe[data-artifact-frame]");
const shown = async (frame: FrameLocator) => JSON.parse((await frame.locator("#values").textContent()) ?? "null");

const openEditor = async (page: Page, id: string, name: string) => {
  const at = await centre(shapeOnScreen(page, id));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: `Editing ${name}` })).toBeVisible();
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
  await expect(editor(page).getByRole("textbox", { name: "Add a parameter" })).toHaveAttribute("placeholder", "Add a parameter… (e.g. the background colour, the title size)");
  // One inset down the column: the header's icon, the dials' title and the parameter box line up.
  const lefts = await Promise.all([
    editor(page).getByTestId("artifact-dials").locator("xpath=ancestor::*[.//header][1]").locator("header svg").first().boundingBox(),
    dials.locator(".dialkit-folder-title-root").boundingBox(),
    editor(page).getByRole("textbox", { name: "Add a parameter" }).boundingBox(),
  ]);
  const [icon, title, box] = lefts.map((each) => Math.round(each!.x));
  expect(Math.abs(title! - icon!)).toBeLessThanOrEqual(1);
  expect(Math.abs(box! - icon!)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");

  await page.mouse.click(640, 600);
  await openEditor(page, "shape:plain", "Plain");
  await expect(editorFrame(page).getByRole("heading", { name: "No parameters here" })).toBeVisible();
  await expect(editor(page).getByText("No parameters yet.")).toBeVisible();
  await expect(editor(page).getByTestId("artifact-dials")).toHaveCount(0);
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
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(box.x + box.width * (0.1 + step * 0.05), box.y + box.height / 2);
    await page.waitForTimeout(30);
  }
  // Live in the frame while the drag is still going.
  await expect.poll(async () => (await shown(editorFrame(page))).size).toBeGreaterThan(50);
  await page.mouse.up();
  const dragged = Number(await slider.getAttribute("aria-valuenow"));
  expect(dragged).toBeGreaterThan(50);
  await expect.poll(async () => (await shown(editorFrame(page))).size).toBe(dragged);
  await expect.poll(() => dialsOf(agent, "shape:tuned"), { timeout: 10_000 }).toEqual({ size: dragged });

  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  // One step: the whole drag goes back at once.
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

  // Another tab tunes the motion: this tab's frame follows at once.
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

  // The agent's next version: caption gone, size now text, a new switch.
  await writeProjectFile(agent, "2-tuned.html", dialsPage({ accent: "#a78bfa", size: "big", glow: true }).replace(BRIDGE_TAG, `${BRIDGE_TAG}<!-- v2 -->`));
  const record = (await roomRecords(agent, "default")).find((item) => item.id === "shape:tuned")!;
  expect(record.props.file).toBe(file);
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

  // DialKit's own class names, as tldraw's are in the tldraw tests: they are the library's, not ours.
  const themed = async (dials: ReturnType<Page["locator"]>, card: ReturnType<Page["locator"]>) => {
    const panel = dials.locator(".dialkit-panel-inner");
    await expect(dials.locator(".dialkit-folder-title-root")).toHaveText("Look");
    await inBothSchemes(page, async (scheme) => {
      await expect(dials.locator(".dialkit-root")).toHaveAttribute("data-theme", scheme);
      // The same fill as the card around it: one surface, not a dark block on a light card.
      await expectToken(panel, "background-color", "--card");
      await expectToken(card, "background-color", "--card");
      await expectToken(dials.locator(".dialkit-slider"), "background-color", "--accent");
      await expectToken(dials.locator(".dialkit-folder-title-root"), "color", "--foreground");
      await expectToken(dials.locator(".dialkit-slider-label"), "color", "--muted-foreground");
      expect(await styleOf(panel, "font-family")).toBe(await styleOf(page.locator("body"), "font-family"));
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

/** Whether DialKit's own stylesheet is on the page (the app's theme only sets its variables): it comes with the first panel. */
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
  // Neither the board nor a selected page loads DialKit: only opening the panel does.
  expect(await dialKitLoaded(page)).toBe(false);
  await expect(parametersToggle(page)).toHaveAttribute("aria-pressed", "false");
  await parametersToggle(page).click();
  const panel = canvasPanel(page, "Tuned");
  await expect(panel).toBeVisible();
  await expect(parametersToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toHaveCount(0);
  expect(await dialKitLoaded(page)).toBe(true);
  // Its header says Parameters once: DialKit names the declaration, and the page is beside it.
  await expect(panel.locator("header")).toHaveText("Parameters");
  // Beside the page, not over it.
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
  // Keys in the panel are the panel's: the arrows did not nudge the page, and Backspace deletes nothing.
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  const after = (await roomRecords(agent, "default")).find((record) => record.id === "shape:tuned");
  expect(after).toBeDefined();
  expect({ x: after!.x, y: after!.y }).toEqual({ x: before.x, y: before.y });

  // Escape closes the panel and leaves the page selected; Cmd-Z then takes the whole change back, in the frame too.
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

  // Open again on the saved values. Selecting the motion closes it; the motion has its own.
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

  // While its panel is open the motion stays live, however far the canvas pans.
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

  // Opening the editor closes the canvas panel; a click on empty canvas closes it too.
  await page.getByTestId("selection-toolbar").getByRole("button", { name: "Open", exact: true }).click();
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
  await expect(box).toHaveAttribute("placeholder", "Describe a parameter… (e.g. the accent colour and the intro speed)");
  await expect(panel.getByText("The agent writes it")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  // Typing stays in the box: Backspace deletes a letter, not the page.
  await box.fill("the background colourx");
  await page.keyboard.press("Backspace");
  await expect(box).toHaveValue("the background colour");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  // The instruction goes to a new chat tagged with the page, and the rail opens on it.
  await expect(box).toHaveValue("", { timeout: 10_000 });
  const [chat] = await engineChats(agent);
  expect(chat?.tags).toEqual(["shape:plain"]);
  expect(await userTexts(agent, chat!.id)).toEqual([addParameterInstruction({ wanted: "the background colour", kind: "page", title: "Plain" })]);
  await expect(page.getByRole("complementary", { name: "Agent" })).toBeVisible();
});
