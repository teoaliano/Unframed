import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { editSummaries } from "./motionHelpers.ts";
import { textOf } from "./editorHarness.ts";
import { putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const motion = (ease: string, dial = false) => `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:60px;height:60px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
window.__timelines = { main: tl };
${dial ? `unframed.dials("Timing", { ease: ["power1.out", "power2.out", "back.out"] }, function (v) {
  tl.clear();
  tl.to("#dot", { x: 400, duration: 1, ease: v.ease }, 0);
});` : `tl.to("#dot", { x: 400, duration: 1, ease: ${ease} }, 0);`}
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const bar = (page: Page) => timeline(page).locator('[data-testid="timeline-row"][data-row-kind="element"][data-row-name="Dot"] [data-testid="timeline-bar"]');
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const choices = (page: Page) => page.getByRole("menuitemradio");
const choice = (page: Page, label: string) => page.getByRole("menuitemradio", { name: label, exact: true });
const fileText = async (engine: TestEngine) => textOf(engine, (await fileOf(engine))!.file);

test.setTimeout(150_000);

const openMotion = async (page: Page, engine: TestEngine, html: string) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(1, { timeout: 40_000 });
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
};

const fileOf = async (engine: TestEngine) => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props;

const openEase = async (page: Page) => {
  await bar(page).dblclick();
  await page.getByRole("button", { name: "Ease", exact: true }).click();
};

test("the ease picker lists the 31 catalogue eases with curves, and the current one is checked", async ({ page, agent }) => {
  await openMotion(page, agent, motion('"power2.out"'));
  await openEase(page);

  await expect(choices(page)).toHaveCount(31);
  for (const name of ["Linear", "Sine · In", "Power2 · Out", "Back · In-out", "Elastic · Out", "Bounce · In-out"]) {
    await expect(choice(page, name)).toHaveCount(1);
  }
  await expect(choice(page, "Power2 · Out").locator("svg polyline")).toHaveCount(1);
  await expect(choice(page, "Power2 · Out")).toHaveAttribute("aria-checked", "true");
  await expect(choice(page, "Power2 · In")).toHaveAttribute("aria-checked", "false");
});

test("choosing an ease writes it into the source as one edit, with its summary", async ({ page, agent }) => {
  await openMotion(page, agent, motion('"power2.out"'));
  await openEase(page);
  await choice(page, "Back · Out").click();

  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)?.[0]), { timeout: 15_000 }).toBe("Eased Dot position with back.out");
  expect(await fileText(agent)).toMatch(/ease:\s*["']back\.out["']/);
});

test("an ease written in a form the list does not name shows as written, checked, and picking another replaces it", async ({ page, agent }) => {
  await openMotion(page, agent, motion('"back.out(3)"'));
  await openEase(page);

  await expect(choices(page)).toHaveCount(32);
  await expect(choice(page, "back.out(3)")).toHaveAttribute("aria-checked", "true");
  await choice(page, "Sine · In").click();
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)?.[0]), { timeout: 15_000 }).toBe("Eased Dot position with sine.in");
});

test("a kit's easing tokens are listed under Kit, and choosing one writes the token", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const KIT = {
    format: 1,
    name: "Brand",
    modes: ["light", "dark"],
    tokens: [{ path: "ease/brand/snap", type: "easing", value: "expo.out" }],
  };
  await putRecords(agent, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: KIT } } }]);
  await openMotion(page, agent, motion('"power2.out"'));
  await openEase(page);

  await expect(choices(page)).toHaveCount(32);
  await choice(page, "ease/brand/snap").click();
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)?.[0]), { timeout: 15_000 }).toBe("Eased Dot position with the ease/brand/snap token");
  expect(await fileText(agent)).toContain('unframed.token("ease/brand/snap")');
});

test("an ease a parameter sets offers only the parameter's options, and choosing one sets the parameter", async ({ page, agent }) => {
  await openMotion(page, agent, motion("", true));
  await openEase(page);

  await expect(choice(page, "Power2 · Out")).toBeEnabled();
  await expect(choice(page, "Back · Out")).toBeEnabled();
  await expect(choice(page, "Sine · In")).toBeDisabled();
  await choice(page, "Sine · In").hover({ force: true });
  await expect(page.getByText("This ease comes from the parameter ease, which offers only its own options.")).toBeVisible();
  await choice(page, "Back · Out").click();

  await expect.poll(async () => (await fileOf(agent))?.dials?.ease, { timeout: 10_000 }).toBe("back.out");
});
