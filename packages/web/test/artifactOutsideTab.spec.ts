import type { FrameLocator, Page } from "@playwright/test";
import { liveViewerUrl } from "@unframed/domain";
import { centre, openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { putRecords } from "./media.ts";
import { dialsPage, filledArtifact, insideComposition, writeBridge, writeProjectFile } from "./artifacts.ts";

const shown = async (frame: FrameLocator) => JSON.parse((await frame.locator("#values").textContent().catch(() => null)) ?? "null");

const recordOf = async (engine: Parameters<typeof roomRecords>[0], id: string) => (await roomRecords(engine, "default")).find((record) => record.id === id)!;

/** The live viewer's frame: the one on screen, not a new version still loading behind it. */
const showing = (tab: Page): FrameLocator => tab.frameLocator("iframe:not(.next)");

test("a page opened in a new tab follows the shape: a new version swaps in without a reload, and a dial change reaches it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100] }), dials: { size: 20 } });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
  const at = await centre(shapeOnScreen(page, "shape:tuned"));
  await page.mouse.dblclick(at.x, at.y);
  const opened = page.context().waitForEvent("page");
  await page.getByRole("region", { name: "Editing Tuned" }).getByRole("button", { name: "Open in a new tab" }).click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe(`http://127.0.0.1:${agent.previewPort}/p/default/unframed-live.html?s=tuned`);
  // The shape's saved values, not the file's defaults.
  await expect.poll(() => shown(showing(tab)), { timeout: 10_000 }).toEqual({ size: 20 });
  await tab.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));

  // The agent's next version: a new file, and the shape pointed at it.
  await writeProjectFile(agent, "2-tuned.html", dialsPage({ size: [10, 0, 100] }).replace('<pre id="values">', '<h1>Version two</h1><pre id="values">'));
  const record = await recordOf(agent, "shape:tuned");
  await putRecords(agent, [{ ...record, props: { ...record.props, file: "2-tuned.html" } }]);
  await expect(showing(tab).getByRole("heading", { name: "Version two" })).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => shown(showing(tab))).toEqual({ size: 20 });
  await expect(tab.locator("iframe")).toHaveCount(1);
  expect(await tab.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);

  // A dial change on the shape, as the editor's write makes it.
  const tuned = await recordOf(agent, "shape:tuned");
  await putRecords(agent, [{ ...tuned, props: { ...tuned.props, dials: { size: 64 } } }]);
  await expect.poll(() => shown(showing(tab)), { timeout: 5_000 }).toEqual({ size: 64 });
  expect(await tab.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  await tab.close();
});

const DIALS_MOTION = (label: string) => `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;overflow:hidden;background:#000;color:#fff}.clip{position:absolute;inset:0}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="3" data-width="640" data-height="360"><div id="c" class="clip" data-start="0" data-duration="3"><p id="label">${label}</p><pre id="values">none</pre></div></div>
<script src="gsap.js"></script>
<script>
window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true });
unframed.dials("Scene", { speed: [1, 0, 5] }, function (v) { document.getElementById("values").textContent = JSON.stringify(v); });
</script></body></html>`;

test("a motion opened in a new tab plays through its viewer and follows its dials and its next version", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:intro", kind: "motion", ref: "151", at: { x: -520, y: 260 }, size: { w: 320, h: 180 }, title: "Intro", html: DIALS_MOTION("one"), dials: { speed: 2.5 } });
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();

  const tab = await page.context().newPage();
  await tab.goto(liveViewerUrl({ appHostname: "localhost", previewPort: agent.previewPort, project: "default", shapeId: "shape:intro" })!);
  const composition = () => insideComposition(showing(tab));
  await expect.poll(() => shown(composition()), { timeout: 15_000 }).toEqual({ speed: 2.5 });

  const record = await recordOf(agent, "shape:intro");
  await putRecords(agent, [{ ...record, props: { ...record.props, dials: { speed: 4 } } }]);
  await expect.poll(() => shown(composition()), { timeout: 5_000 }).toEqual({ speed: 4 });

  const { file } = (await (await agent.rpc()).call("motion.upload", { project: "default", fileName: "intro.html", html: DIALS_MOTION("two") })) as { file: string };
  const current = await recordOf(agent, "shape:intro");
  await putRecords(agent, [{ ...current, props: { ...current.props, file } }]);
  await expect(composition().locator("#label")).toHaveText("two", { timeout: 15_000 });
  await expect.poll(() => shown(composition())).toEqual({ speed: 4 });
  await tab.close();
});
