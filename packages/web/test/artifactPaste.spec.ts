import { readFile, rm } from "node:fs/promises";
import { copySelection, openCanvas, shapeOnScreen, toast, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a pasted artifact gets its own copy of its file with a copy sidecar; a copy that fails pastes the shape empty and says so", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const { file } = await filledArtifact(engine, { id: "shape:intro", kind: "motion", ref: "150", at: { x: 440, y: 60 }, title: "Intro", html: "<div id=root>intro</div>" });
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);

  await clickShape(page, "shape:intro");
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "motion" && record.id !== "shape:intro"));
  expect(pasted.props.file).not.toBe(file);
  expect(pasted.props.title).toBe("Intro");
  expect(await readFile(projectPath(engine, pasted.props.file), "utf8")).toBe(await readFile(projectPath(engine, file), "utf8"));
  expect(JSON.parse(await readFile(projectPath(engine, pasted.props.file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({ source: "copy", of: file, mime: "text/html" });

  // The paste lands on top of the original and is selected: out of the way, so the next click reaches the original.
  await page.keyboard.press("Delete");
  await waitForRoom(engine, "default", (records) => !records.some((record) => record.id === pasted.id));

  // The source file is gone by the time of the next paste: the copy pastes empty.
  await rm(projectPath(engine, file));
  await clickShape(page, "shape:intro");
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");
  const empty = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "motion" && record.id !== "shape:intro" && record.id !== pasted.id));
  expect(empty.props.file).toBe("");
  await expect(toast(page, /^Could not copy the motion's file: /)).toBeVisible();
});
