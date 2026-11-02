import { writeFile } from "node:fs/promises";
import { openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { artifactShape, filledArtifact, projectPath } from "./artifacts.ts";
import { putRecords } from "./media.ts";

const MOTION = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }) };</script></body></html>`;

test("a canvas saved before element editing opens with its pages and motions intact, and a page carrying locks opens with them", async ({ page, agent }) => {
  // The project folder comes into being when the canvas opens; the records are then saved and the app reopens them.
  await openCanvas(page, agent);
  // A page saved before the lock field existed, a page with one locked element, and a motion.
  await filledArtifact(agent, { id: "shape:old", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Old", html: "<h1>Old page</h1>" });
  await writeFile(projectPath(agent, "2-locked.html"), '<script src="unframed-dials.js"></script>\n<h1 data-hf-id="hf-aaaa">Locked page</h1>');
  await putRecords(agent, [
    { ...artifactShape({ id: "shape:locked", kind: "page", ref: "151", at: { x: -520, y: 220 }, size: { w: 300, h: 200 } }), props: { w: 300, h: 200, file: "2-locked.html", title: "Locked", fileName: "", lockedElements: ["hf-aaaa"] } },
  ]);
  await filledArtifact(agent, { id: "shape:intro", kind: "motion", ref: "152", at: { x: 260, y: -40 }, size: { w: 320, h: 180 }, title: "Intro", html: MOTION });

  await page.reload();
  await openCanvas(page, agent);
  await expect(shapeOnScreen(page, "shape:old")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:locked")).toBeVisible();
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();
  await expect(page.locator("[data-slot='toast-title']")).toHaveCount(0);

  // The records keep their props: the old page has no locks, the locked page keeps its one.
  const pages = await roomShapes(agent, "default", "page");
  expect(pages.find((record) => record.id === "shape:old")?.props).toMatchObject({ file: expect.stringMatching(/\.html$/), title: "Old" });
  expect(pages.find((record) => record.id === "shape:locked")?.props).toMatchObject({ file: "2-locked.html", lockedElements: ["hf-aaaa"] });
  expect((await roomShapes(agent, "default", "motion")).find((record) => record.id === "shape:intro")?.props).toMatchObject({ title: "Intro" });
});
