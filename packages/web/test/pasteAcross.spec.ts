import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { copySelection, openCanvas, shapeOnScreen, toast, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, putRecords, uploadToEngine } from "./media.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const pageShape = (id: string, ref: string, file: string, at: { x: number; y: number }) => ({
  id,
  typeName: "shape",
  type: "page",
  x: at.x,
  y: at.y,
  rotation: 0,
  index: "a7",
  parentId: "page:page",
  isLocked: false,
  opacity: 1,
  props: { w: 480, h: 320, file, fileName: "landing.html", title: "landing" },
  meta: { ref },
});

test("pasting into another project copies every file in; a pasted page always gets its own copy; a failed copy pastes the shape empty", async ({ page, engine }) => {
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "alpha" });
  await rpc.call("projects.create", { name: "beta" });
  await rpc.call("preferences.set", { key: "project.active", value: "alpha" });
  await openCanvas(page, engine, "alpha");

  await filledMedia(engine, {
    id: "shape:photo",
    type: "image",
    ref: "150",
    at: { x: 440, y: 60 },
    bytes: pngBytes(300, 150),
    name: "photo.png",
    mime: "image/png",
    natural: { w: 300, h: 150 },
    project: "alpha",
  });
  const pageFile = await uploadToEngine(engine, "landing.html", Buffer.from("<h1>alpha</h1>"), "text/html", "alpha");
  await putRecords(engine, [pageShape("shape:landing", "151", pageFile, { x: 440, y: 260 })], "alpha");

  await expect(shapeOnScreen(page, "shape:landing")).toHaveCount(1);
  await expect(shapeOnScreen(page, "shape:photo")).toHaveCount(1);

  // Within one project, a pasted page gets its own copy of its file.
  await page.mouse.click(10, 400);
  await page.keyboard.press("ControlOrMeta+a");
  await copySelection(page, ["text/html", "image/png"]);
  await page.keyboard.press("ControlOrMeta+v");
  const samePaste = await waitForRoom(engine, "alpha", (records) => {
    const pages = records.filter((record) => record.type === "page");
    return pages.length === 2 ? pages.find((record) => record.id !== "shape:landing") : undefined;
  });
  expect(samePaste.props.file).not.toBe(pageFile);
  expect(await readFile(join(engine.dataDir, "output", "alpha", samePaste.props.file), "utf8")).toBe("<h1>alpha</h1>");

  // Into another project, every file is copied in.
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("menuitem", { name: "beta" }).click();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+v");
  const betaRecords = await waitForRoom(engine, "beta", (records) => {
    const shapes = records.filter((record) => record.typeName === "shape" && (record.type === "image" || record.type === "page"));
    return shapes.length >= 2 ? records : undefined;
  });
  const betaFolder = join(engine.dataDir, "output", "beta");
  const betaFiles = await readdir(betaFolder);
  const betaImage = betaRecords.find((record) => record.typeName === "shape" && record.type === "image")!;
  const betaAsset = betaRecords.find((record) => record.id === betaImage.props.assetId)!;
  const copied = String(betaAsset.props.src).slice("project-file:".length);
  expect(betaFiles).toContain(copied);
  expect(JSON.parse(await readFile(join(betaFolder, copied.replace(/\.png$/, ".json")), "utf8"))).toMatchObject({ source: "copy" });
  const betaPage = betaRecords.find((record) => record.typeName === "shape" && record.type === "page")!;
  expect(betaFiles).toContain(betaPage.props.file);

  // A file that cannot be copied pastes its shape empty, and says so.
  await rm(join(engine.dataDir, "output", "alpha", pageFile));
  await rm(join(engine.dataDir, "output", "alpha", samePaste.props.file));
  const before = new Set(betaRecords.map((record) => record.id));
  await page.keyboard.press("ControlOrMeta+v");
  await expect(toast(page, /^Could not copy the page's file: /)).toBeVisible();
  const emptied = await waitForRoom(engine, "beta", (records) => records.find((record) => record.type === "page" && !before.has(record.id)));
  expect(emptied.props.file).toBe("");
});
