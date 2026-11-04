import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomRecords, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { dialsPage, filledArtifact, projectPath, writeBridge } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { editor, outline, parameters } from "./editorHarness.ts";

const region = (page: Page) => page.getByRole("region", { name: "Editing Tuned" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const sizeField = (page: Page) => parameters(page).getByRole("spinbutton", { name: "Size", exact: true });

const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomRecords(engine, "default")).find((record) => record.id === "shape:tuned")?.props.file;

const dialsOf = async (engine: TestEngine): Promise<unknown> => (await roomRecords(engine, "default")).find((record) => record.id === "shape:tuned")?.props.dials;

const shownScroll = async (page: Page): Promise<number> => {
  const handle = await region(page).locator("iframe[data-artifact-frame]").elementHandle();
  const inside = await handle!.contentFrame();
  return inside!.evaluate(() => window.scrollY);
};

const settledScroll = async (page: Page): Promise<number> => {
  let last = await shownScroll(page);
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(150);
        const now = await shownScroll(page);
        const holds = now === last;
        last = now;
        return holds;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  return last;
};

const preparedFile = async (engine: TestEngine): Promise<string> => {
  let found = "";
  await expect
    .poll(
      async () => {
        const file = await fileOf(engine);
        if (file === undefined) return false;
        found = file;
        return (await readFile(projectPath(engine, file), "utf8")).includes("data-hf-id");
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found;
};

const watchShownFrames = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-testid="artifact-preview"]');
    if (!host) throw new Error("the editor shows no preview");
    const frames = () => [...host.querySelectorAll<HTMLIFrameElement>("iframe[data-artifact-frame], iframe[data-artifact-frame-incoming]")];
    const watch = (frame: HTMLIFrameElement) => {
      if (frame.dataset.watched === "1") return;
      frame.dataset.watched = "1";
      frame.addEventListener("load", () => {
        frame.dataset.loaded = "1";
      });
    };
    for (const frame of frames()) {
      watch(frame);
      frame.dataset.loaded = "1";
    }
    new MutationObserver(() => frames().forEach(watch)).observe(host, { childList: true, subtree: true });
    const shown: boolean[] = [];
    let last: Element | undefined;
    const sample = () => {
      const visible = frames().find((frame) => getComputedStyle(frame).visibility === "visible");
      if (visible && visible !== last) {
        last = visible;
        shown.push(visible.dataset.loaded === "1");
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    (window as unknown as { __shownFrames: boolean[] }).__shownFrames = shown;
  });

const shownFrames = (page: Page): Promise<boolean[]> => page.evaluate(() => (window as unknown as { __shownFrames: boolean[] }).__shownFrames);

const selectValues = async (page: Page) => {
  await expect(async () => {
    await frameOf(page).locator("#values").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

test("a commit shows the new version without a blank frame, and the saved dials and the selection stay", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await writeBridge(agent);
  await filledArtifact(agent, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100] }).replace("</body>", '<div id="spacer" style="height: 1600px"></div></body>') });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();

  const centreAt = await centre(shapeOnScreen(page, "shape:tuned"));
  await page.mouse.dblclick(centreAt.x, centreAt.y);
  await expect(region(page)).toBeVisible();
  await preparedFile(agent);
  await selectValues(page);
  await expect(frameOf(page).locator("#values")).toHaveText('{"size":10}');

  await watchShownFrames(page);

  await parameters(page).getByRole("tab", { name: "Parameters" }).click();
  const slider = editor(page).getByRole("slider", { name: "Size" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => dialsOf(agent), { timeout: 10_000 }).toEqual({ size: 13 });
  await parameters(page).getByRole("tab", { name: "Design" }).click();

  await frameOf(page).locator("#spacer").hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => shownScroll(page), { timeout: 2000 }).toBeGreaterThan(100);
  await settledScroll(page);
  const before = (await fileOf(agent))!;
  await sizeField(page).fill("30");
  await sizeField(page).press("Enter");
  const scrolledTo = await settledScroll(page);
  await expect.poll(() => fileOf(agent), { timeout: 8000 }).not.toBe(before);
  const after = (await fileOf(agent))!;
  expect(after).not.toBe(before);

  await expect.poll(async () => frameOf(page).locator("#values").textContent(), { timeout: 8000 }).toContain('"size":13');
  const shown = await shownFrames(page);
  expect(shown.length).toBeGreaterThanOrEqual(2);
  expect(shown.every(Boolean)).toBe(true);
  expect(await readFile(projectPath(agent, after), "utf8")).toMatch(/font-size:\s*30px/);

  await expect.poll(() => shownScroll(page), { timeout: 8000 }).toBe(scrolledTo);

  await expect(outline(page, "selected")).toHaveCount(1, { timeout: 8000 });
});
