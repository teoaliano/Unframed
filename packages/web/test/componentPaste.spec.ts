import { readFile, stat } from "node:fs/promises";
import { compiledFileName } from "@unframed/domain";
import { centre, copySelection, openCanvas, roomShapes, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { componentShape, SHEET_FILE, writeSheet } from "./components.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import { putRecords } from "./media.ts";

/** Spec 20, task 40: a pasted component shape is a new component with its own tag; a page pasted into another project brings its components. */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const PAGE = `<!doctype html><html><head><script src="${compiledFileName(SHEET_FILE)}" data-uf-component="uf-price-card"></script></head><body style="margin:0;font:16px sans-serif"><uf-price-card label="Buy"></uf-price-card></body></html>`;

test("pasting a component shape makes a new component with its own tag and sheet; the original keeps its tag", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeSheet(engine, { tag: "uf-price-card", variants: {} });
  await putRecords(engine, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })]);
  await expect(shapeOnScreen(page, "shape:card")).toBeVisible();

  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:card"));
  await page.mouse.click(at.x, at.y);
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");

  const pasted = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "component" && record.id !== "shape:card"));
  expect(pasted.props.tag).toBe("uf-price-card-copy");
  expect(pasted.props.file).not.toBe(SHEET_FILE);
  await stat(projectPath(engine, pasted.props.file));
  await stat(projectPath(engine, compiledFileName(pasted.props.file)));
  const original = (await roomShapes(engine, "default", "component")).find((record) => record.id === "shape:card");
  expect(original?.props.tag).toBe("uf-price-card");
  expect(original?.props.file).toBe(SHEET_FILE);
});

test("pasting a page into another project brings the component files it pins", async ({ page, engine }) => {
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "alpha" });
  await rpc.call("projects.create", { name: "beta" });
  await rpc.call("preferences.set", { key: "project.active", value: "alpha" });
  await openCanvas(page, engine, "alpha");

  await writeSheet(engine, { tag: "uf-price-card", variants: {} }, SHEET_FILE, "alpha");
  await putRecords(engine, [componentShape({ id: "shape:card", ref: "150", at: { x: 420, y: 60 }, tag: "uf-price-card", title: "Price card" })], "alpha");
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE, project: "alpha" });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();

  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.click(at.x, at.y);
  await copySelection(page, ["text/html"]);

  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name: "beta" }).click();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+v");

  const pastedPage = await waitForRoom(engine, "beta", (records) => records.find((record) => record.type === "page"));
  expect(pastedPage.props.file).not.toBe("");
  // The sheet and its compiled file are in beta under the same names, so the pasted page's pin resolves there.
  const sheet = await readFile(projectPath(engine, SHEET_FILE, "beta"), "utf8");
  expect(sheet).toBe(await readFile(projectPath(engine, SHEET_FILE, "alpha"), "utf8"));
  await stat(projectPath(engine, compiledFileName(SHEET_FILE), "beta"));
});
