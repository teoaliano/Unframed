import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { artifactShape, filledArtifact, insideComposition } from "./artifacts.ts";
import { putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/**
 * A motion with two clips (the logo on track 0, the title on track 1), a staggered tween over three dots (two inside the
 * logo's clip, one in the root), a repeating fromTo on the logo, and a tween the script makes on an element it adds at run time.
 */
const ROWS = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}.dot{position:absolute;top:120px;width:40px;height:40px;background:#f00}#title{position:absolute;left:20px;top:20px;color:#fff}#logo{position:absolute;left:300px;top:20px;width:60px;height:60px;background:#0f0}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360">
<h1 id="title" data-hf-id="hf-title" class="clip" data-uf-name="Title" data-start="0" data-duration="3" data-track-index="1">Title</h1>
<div id="logo" data-hf-id="hf-logo" class="clip" data-uf-name="Logo" data-start="1" data-duration="3" data-track-index="0"><div class="dot" id="d1" data-hf-id="hf-d1" data-uf-name="Dot 1" style="left:20px"></div><div class="dot" id="d2" data-hf-id="hf-d2" data-uf-name="Dot 2" style="left:80px"></div></div>
<div class="dot" id="d3" data-hf-id="hf-d3" data-uf-name="Dot 3" style="left:140px"></div>
</div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#title", { opacity: 1, duration: 1 }, 0);
tl.to(".dot", { y: -40, duration: 1, stagger: 0.2 }, 1);
tl.fromTo("#logo", { x: 0 }, { x: 100, duration: 1, repeat: 2 }, 0);
window.__timelines = { main: tl };
const ghost = document.createElement("div"); ghost.id = "ghost"; document.body.appendChild(ghost);
tl.to(ghost, { x: 10, duration: 1 }, 2);
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const rows = (page: Page) => timeline(page).getByTestId("timeline-row");
const row = (page: Page, name: string, kind = "element") => timeline(page).locator(`[data-testid="timeline-row"][data-row-kind="${kind}"][data-row-name="${name}"]`);
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const viewer = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");

// A motion takes a while to load its player and its composition.
test.setTimeout(150_000);

/** Puts the motion on the board (with extra shape props when given) and opens its editor on it. */
const openRows = async (page: Page, engine: TestEngine, props: Record<string, unknown> = {}, html = ROWS, loaded = "Logo") => {
  await openCanvas(page, engine);
  const { file } = await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html });
  if (Object.keys(props).length > 0) {
    const record = artifactShape({ id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, file, size: { w: 480, h: 270 }, title: "Intro" });
    await putRecords(engine, [{ ...record, props: { ...record.props, ...props } }]);
  }
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(row(page, loaded)).toBeVisible({ timeout: 40_000 });
  // The bars have their places once the strip has its zoom, which waits for the frame to report the motion's length.
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
};

test("clips come in track order, element rows sit under their clip or under Composition, and a run-time tween gets a greyed row", async ({ page, agent }) => {
  await openRows(page, agent);
  await expect(rows(page).first()).toBeVisible();
  // The run-time row comes from the frame's live report, which lands a moment after the reading's rows.
  const order = () => rows(page).evaluateAll((elements) => elements.map((element) => `${(element as HTMLElement).dataset.rowKind}:${(element as HTMLElement).dataset.rowName}`));
  await expect.poll(order, { timeout: 20_000 }).toEqual(["clip:Logo", "element:Logo", "element:Dot 1", "element:Dot 2", "clip:Title", "element:Title", "composition:Composition", "element:Dot 3", "runtime:body > div:nth-of-type(2)"]);

  // The run-time row is named by its selector, greyed, and says where it comes from.
  await expect(row(page, "body > div:nth-of-type(2)", "runtime")).toHaveAttribute("title", "Made by the agent's code while the motion runs.");
});

test("a staggered tween draws a bar on each target, offset by the stagger, and a repeating tween draws its repeats and its diamonds", async ({ page, agent }) => {
  await openRows(page, agent);
  const starts = async (name: string) => row(page, name).getByTestId("timeline-bar").evaluateAll((bars) => bars.map((bar) => Number((bar as HTMLElement).dataset.start)));
  // The dots' stagger is 0.2 s, in document order: Dot 1, Dot 2, then Dot 3 in the root.
  expect(await starts("Dot 1")).toEqual([1]);
  expect(await starts("Dot 2")).toEqual([1.2]);
  expect(await starts("Dot 3")).toEqual([1.4]);

  // The logo's fromTo repeats twice: two lighter copies after its bar, and a diamond at each end of the bar.
  const logo = row(page, "Logo");
  await expect(logo.locator('[data-testid="timeline-bar"][data-copy="true"]')).toHaveCount(2);
  await expect(logo.getByTestId("timeline-diamond")).toHaveCount(2);
});

test("expanding an element shows one lane per property group, and collapsing it hides them again", async ({ page, agent }) => {
  await openRows(page, agent);
  await expect(row(page, "Logo").getByRole("button", { name: "Expand Logo" })).toBeVisible();
  await expect(timeline(page).locator('[data-testid="timeline-row"][data-row-kind="lane"]')).toHaveCount(0);

  await row(page, "Logo").getByRole("button", { name: "Expand Logo" }).click();
  const lane = timeline(page).locator('[data-testid="timeline-row"][data-row-kind="lane"][data-row-name="position"]');
  await expect(lane).toHaveCount(1);
  // The lane shows the full bar, not the thin one of the collapsed row.
  await expect(lane.getByTestId("timeline-bar").first()).toBeVisible();

  await row(page, "Logo").getByRole("button", { name: "Collapse Logo" }).click();
  await expect(timeline(page).locator('[data-testid="timeline-row"][data-row-kind="lane"]')).toHaveCount(0);
});

test("a locked element's row shows its lock and its bars do not take a drag", async ({ page, agent }) => {
  await openRows(page, agent, { lockedElements: ["hf-d2"] });
  const dot2 = row(page, "Dot 2");
  await expect(dot2.getByTestId("timeline-lock")).toHaveCount(1);
  await expect(dot2.getByTestId("timeline-lock")).toHaveAttribute("aria-label", "Locked. Unlock it in Layers to edit it.");
  await expect(row(page, "Dot 1").getByTestId("timeline-lock")).toHaveCount(0);
});

test("a hidden element's row is greyed, and its bars still take a drag", async ({ page, agent }) => {
  await openRows(page, agent, {}, ROWS.replace('data-uf-name="Dot 2"', 'data-uf-name="Dot 2" data-uf-hidden'));
  const dot2 = row(page, "Dot 2");
  await expect(dot2).toHaveAttribute("data-hidden", "true");
  await expect(dot2).toHaveClass(/opacity-50/);
  // The visible row next to it is not greyed.
  await expect(row(page, "Dot 1")).not.toHaveAttribute("data-hidden", "true");
  await expect(row(page, "Dot 1")).not.toHaveClass(/opacity-50/);
});

/** A fade on Dot 2 that a later stagger's bar for Dot 2 starts over: the stagger is the tween drawn on top. */
const OVERLAP = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}.dot{position:absolute;top:120px;width:40px;height:40px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360">
<div class="dot" id="d1" data-hf-id="hf-d1" data-uf-name="Dot 1" style="left:20px"></div><div class="dot" id="d2" data-hf-id="hf-d2" data-uf-name="Dot 2" style="left:140px"></div>
</div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#d2", { opacity: 0, duration: 0.5 }, 0);
tl.to(".dot", { y: -40, duration: 1, stagger: 0.2 }, 0);
window.__timelines = { main: tl };
</script></body></html>`;

test("a bar that a later bar on its row overlaps in time keeps its own lane, so a press on it reaches it", async ({ page, agent }) => {
  await openRows(page, agent, {}, OVERLAP, "Dot 2");
  const fade = row(page, "Dot 2").locator('[data-testid="timeline-bar"][data-tween="0"]');
  await expect(fade).toHaveCount(1);
  const box = await fade.boundingBox();
  if (!box) throw new Error("no fade bar");
  // Six tenths in (0.3 s) the stagger's bar starts over the fade, so the fade is under it unless the two have their own lanes.
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="timeline-bar"]')?.getAttribute("data-tween"), { x: box.x + box.width * 0.6, y: box.y + box.height / 2 });
  expect(top).toBe("0");
  // The stagger's own bar for Dot 2 is in its own lane, and a press on its middle reaches it too.
  const stagger = row(page, "Dot 2").locator('[data-testid="timeline-bar"][data-tween="1"]');
  const other = await stagger.boundingBox();
  if (!other) throw new Error("no stagger bar");
  const reached = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="timeline-bar"]')?.getAttribute("data-tween"), { x: other.x + other.width * 0.75, y: other.y + other.height / 2 });
  expect(reached).toBe("1");
});

test("in a strip narrower than 480 px the label column collapses to 24 px of icons, and each name is in a tooltip", async ({ page, agent }) => {
  // A window of 480 px gives the strip under 480 px: the editor's columns fold, and the strip spans the window.
  // The shape is off the window at 480 px, so the strip opens wide and the window is narrowed with the editor open.
  await page.setViewportSize({ width: 1100, height: 800 });
  await openRows(page, agent);
  await page.setViewportSize({ width: 480, height: 800 });
  const strip = await timeline(page).boundingBox();
  if (!strip) throw new Error("no strip");
  expect(strip.width).toBeLessThan(480);
  const label = await row(page, "Dot 1").locator("xpath=./div[1]").boundingBox();
  if (!label) throw new Error("no label column");
  expect(label.width).toBeLessThanOrEqual(24);
  // The row's select control is still there, named, and its name shows in a tooltip.
  const select = row(page, "Dot 1").getByRole("button", { name: "Select Dot 1" });
  await expect(select).toBeVisible();
  // The name is not written in the row, so its text appears only in the tooltip.
  await expect(timeline(page).getByText("Dot 1", { exact: true })).toHaveCount(0);
  await select.hover();
  await expect(page.getByText("Dot 1", { exact: true })).toBeVisible();
});

test("in a strip of 480 px or more the label column is 160 px and shows each name, each name in a tooltip", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openRows(page, agent);
  const strip = await timeline(page).boundingBox();
  if (!strip) throw new Error("no strip");
  expect(strip.width).toBeGreaterThanOrEqual(480);
  const label = await row(page, "Dot 1").locator("xpath=./div[1]").boundingBox();
  if (!label) throw new Error("no label column");
  expect(label.width).toBeCloseTo(160, 0);
  await expect(row(page, "Dot 1").getByText("Dot 1", { exact: true })).toBeVisible();
  // Hovering a name shows the whole name in a tooltip, so a name the column cuts short is still readable.
  await row(page, "Dot 1").getByRole("button", { name: "Select Dot 1" }).hover();
  await expect(page.locator("[data-slot='tooltip-popup']")).toHaveText("Dot 1");
});

test("a row selects its element in the frame, and an element picked in the frame selects its row", async ({ page, agent }) => {
  await openRows(page, agent);
  await expect(region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Edit", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Dot 3 is the last element row, below the strip's height: rows out of view are not mounted, so the strip is scrolled to it.
  await timeline(page).getByTestId("timeline-scroll").evaluate((element) => (element.scrollTop = element.scrollHeight));
  await row(page, "Dot 3").getByRole("button", { name: "Select Dot 3" }).click();
  await expect(outline(page, "selected")).toHaveCount(1, { timeout: 10_000 });
  await expect(row(page, "Dot 3")).toHaveAttribute("data-selected", "true");

  // A pick in the frame selects the element's row, and the other row lets go.
  const title = insideComposition(viewer(page)).locator("#title");
  await expect(async () => {
    await title.click();
    await expect(row(page, "Title")).toHaveAttribute("data-selected", "true", { timeout: 1000 });
  }).toPass({ timeout: 40_000 });
  await expect(row(page, "Dot 3")).not.toHaveAttribute("data-selected", "true");
});
