import type { FrameLocator, Page } from "@playwright/test";
import { BRIDGE_TAG } from "@unframed/domain";
import { connectTab } from "../../engine/test/syncClient.ts";
import { centre, openCanvas, roomRecords, settledRecord, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { dialsPage, filledArtifact, insideComposition, insideFrame, writeBridge, writeProjectFile } from "./artifacts.ts";
import { inBothSchemes, styleOf, tokenColor } from "./kit.ts";

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

test("the dials panel stays dark in both schemes, in the kit's dark tokens", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [12, 8, 40] }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  await openEditor(page, "shape:tuned", "Tuned");
  const dials = editor(page).getByTestId("artifact-dials");
  // DialKit's own class names, as tldraw's are in the tldraw tests: they are the library's, not ours.
  const panel = dials.locator(".dialkit-panel-inner");
  const title = dials.locator(".dialkit-folder-title-root");
  const label = dials.locator(".dialkit-slider-label");
  const track = dials.locator(".dialkit-slider");
  await expect(title).toHaveText("Look");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-unframed-theme", "dark");
  const dark = { card: await tokenColor(page, "--card"), foreground: await tokenColor(page, "--foreground"), muted: await tokenColor(page, "--muted-foreground"), accent: await tokenColor(page, "--accent") };
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-unframed-theme", "light");
  expect(await tokenColor(page, "--card")).not.toBe(dark.card);

  await inBothSchemes(page, async () => {
    await expect.poll(() => styleOf(panel, "background-color")).toBe(dark.card);
    expect(await styleOf(track, "background-color")).toBe(dark.accent);
    await expect.poll(() => styleOf(title, "color")).toBe(dark.foreground);
    await expect.poll(() => styleOf(label, "color")).toBe(dark.muted);
    expect(await styleOf(panel, "font-family")).toBe(await styleOf(page.locator("body"), "font-family"));
  });
});
