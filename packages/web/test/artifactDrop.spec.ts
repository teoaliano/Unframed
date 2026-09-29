import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { centre, emptyCanvasPoint, openCanvas, roomRecords, settledRecord, shapeOnScreen, toast, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { dropFiles, putRecords } from "./media.ts";
import { artifactShape, filledArtifact, insideComposition, insideFrame, projectPath } from "./artifacts.ts";
import { createChat, engineChat, rail, openRail, test as agentTest } from "./agent.ts";

const COMPOSITION = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;overflow:hidden;background:#123}.clip{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:700 48px sans-serif}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360">
  <div id="t" class="clip" data-start="0" data-duration="4"><span id="word">Dropped in</span></div>
</div>
<script src="gsap.js"></script>
<script>window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true }); window.__timelines.main.fromTo("#word", { opacity: 0.2 }, { opacity: 1, duration: 4 }, 0);</script>
</body></html>`;

test("dropped .html files become pages at the drop point, 24 apart; a failed upload says which file", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const point = await emptyCanvasPoint(page);
  await dropFiles(page, point, [
    { name: "One.html", mime: "text/html", bytes: Buffer.from("<h1>one</h1>") },
    { name: "Two.htm", mime: "", bytes: Buffer.from("<h1>two</h1>") },
  ]);
  const pages = await waitForRoom(engine, "default", (records) => {
    const found = records.filter((record) => record.type === "page");
    return found.length === 2 ? found : undefined;
  });
  const one = pages.find((record) => record.props.fileName === "One.html")!;
  const two = pages.find((record) => record.props.fileName === "Two.htm")!;
  expect(one.props).toMatchObject({ title: "One", w: 480, h: 320 });
  expect(two.props.title).toBe("Two");
  expect(two.x! - one.x!).toBeCloseTo(24, 5);
  expect(two.y! - one.y!).toBeCloseTo(24, 5);
  expect(await readFile(projectPath(engine, one.props.file), "utf8")).toBe("<h1>one</h1>");

  await dropFiles(page, await emptyCanvasPoint(page), [{ name: "empty.html", mime: "text/html", bytes: Buffer.alloc(0) }]);
  await expect(toast(page, "Could not add empty.html: No file bytes in the request body.")).toBeVisible();
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "page")).toHaveLength(2);
});

test("an .html dropped on a page replaces its file and keeps its title, and Cmd-Z shows the previous version", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const { file: first } = await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: 440, y: 60 }, title: "Landing", html: "<h1>First version</h1>" });
  await putRecords(engine, [artifactShape({ id: "shape:blank", kind: "page", ref: "151", at: { x: 440, y: 440 }, size: { w: 300, h: 200 } })]);
  await expect(shapeOnScreen(page, "shape:blank")).toBeVisible();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);

  // An empty page takes the dropped file's name as its title.
  await dropFiles(page, await centre(shapeOnScreen(page, "shape:blank")), [{ name: "Pricing.html", mime: "text/html", bytes: Buffer.from("<h1>Pricing</h1>") }]);
  await waitForRoom(engine, "default", (records) => records.find((record) => record.id === "shape:blank" && record.props.title === "Pricing"));

  await dropFiles(page, await centre(shapeOnScreen(page, "shape:landing")), [{ name: "Second.html", mime: "text/html", bytes: Buffer.from("<h1>Second version</h1>") }]);
  const replaced = await waitForRoom(engine, "default", (records) => {
    const shape = records.find((record) => record.id === "shape:landing");
    return shape && shape.props.file !== first ? shape : undefined;
  });
  expect(replaced.props).toMatchObject({ title: "Landing", fileName: "Second.html" });
  expect(await readFile(projectPath(engine, replaced.props.file), "utf8")).toBe("<h1>Second version</h1>");
  expect(existsSync(projectPath(engine, first))).toBe(true);
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "page")).toHaveLength(2);

  // The replace is one undo step: Cmd-Z points the page back at the file it had.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await settledRecord(engine, "default", "shape:landing"))?.props.file).toBe(first);
  expect((await roomRecords(engine, "default")).find((record) => record.id === "shape:blank")?.props.title).toBe("Pricing");
  await clickShape(page, "shape:landing");
  await expect(insideFrame(page, "shape:landing").getByRole("heading", { name: "First version" })).toBeVisible();
});

test("a composition dropped on a motion goes through the motion upload and plays in the viewer", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [artifactShape({ id: "shape:intro", kind: "motion", ref: "150", at: { x: 440, y: 60 }, title: "Intro" })]);
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();
  await dropFiles(page, await centre(shapeOnScreen(page, "shape:intro")), [{ name: "intro.html", mime: "text/html", bytes: Buffer.from(COMPOSITION) }]);
  const filled = await waitForRoom(engine, "default", (records) => records.find((record) => record.id === "shape:intro" && record.props.file !== ""));
  expect(filled.props).toMatchObject({ title: "Intro", fileName: "intro.html" });
  const saved = await readFile(projectPath(engine, filled.props.file), "utf8");
  expect(saved).toContain("data-hyperframes-preview-runtime");
  expect(saved).toContain('<script src="unframed-dials.js"></script>');
  for (const name of ["hyperframes-viewer.html", "hyperframes-player.js", "hyperframes-runtime.js", "gsap.js", "unframed-dials.js"]) expect(existsSync(projectPath(engine, name)), name).toBe(true);

  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);
  await clickShape(page, "shape:intro");
  const viewer = insideFrame(page, "shape:intro");
  await expect(insideComposition(viewer).locator("#word")).toHaveText("Dropped in", { timeout: 15_000 });
  // Muted, with controls, and playing on its own.
  const player = viewer.locator("hyperframes-player");
  await expect(player).toHaveAttribute("muted", "");
  await expect(player).toHaveAttribute("controls", "");
  await expect.poll(() => player.evaluate((element: any) => element.currentTime as number), { timeout: 15_000 }).toBeGreaterThan(0);
});

agentTest("deleting an artifact asks nothing and keeps its files and chats; Cmd-Z brings it back with its chat tags", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const { file } = await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: 440, y: 60 }, title: "Landing", html: "<h1>Hi</h1>" });
  const chatId = await createChat(agent, { title: "About landing", tags: ["shape:landing"] });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);
  await clickShape(page, "shape:landing");
  await page.keyboard.press("Delete");
  await expect(shapeOnScreen(page, "shape:landing")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await roomRecords(agent, "default")).some((record) => record.id === "shape:landing")).toBe(false);
  expect(existsSync(projectPath(agent, file))).toBe(true);
  expect((await engineChat(agent, chatId)).tags).toEqual(["shape:landing"]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await expect.poll(async () => (await roomRecords(agent, "default")).find((record) => record.id === "shape:landing")?.props.file).toBe(file);
  // Selected again, it finds the chat about it.
  await clickShape(page, "shape:landing");
  await openRail(page);
  await expect(rail(page).getByRole("tab", { name: /About landing/ })).toBeVisible();
});
