import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { openCanvas, plainText, roomRecords, shapeOnScreen } from "./canvas.ts";
import { clickShape, composer, instructionBox, openComposer, pressSend, sendButton } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { filledMedia, promptRecord, putRecords } from "./media.ts";
import { expect, imageResults, setFree, test, type TextGeneration } from "./texting.ts";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Final prompt" });
const sections = (page: Page) => dialog(page).getByRole("textbox", { name: "Sections" });
const rows = (page: Page) => dialog(page).getByRole("list", { name: "Runs" }).getByRole("listitem");

const setUp = async (page: Page, generation: TextGeneration, list: string) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await filledMedia(engine, { id: "shape:photo", type: "image", ref: "300", at: { x: 540, y: 40 }, bytes: pngBytes(30, 30, 1), name: "photo.png", mime: "image/png", natural: { w: 30, h: 30 }, width: 120 });
  await putRecords(engine, [promptRecord("shape:list", "301", list, { x: 40, y: -80 })]);
  await expect(shapeOnScreen(page, "shape:list")).toBeVisible();
};

/** Opens the composer on the list, the scene and the photo with Free and View final prompt, types `instruction`, and sends. */
const stage = async (page: Page, instruction = "") => {
  await page.mouse.click(10, 400);
  await clickShape(page, "shape:list");
  await clickShape(page, "shape:starter-scene", ["Shift"]);
  await clickShape(page, "shape:photo", ["Shift"]);
  await openComposer(page);
  await setFree(page, true);
  if (instruction !== "") {
    await instructionBox(page).click();
    await page.keyboard.type(instruction);
  }
  await pressSend(page);
  await expect(dialog(page)).toBeVisible();
};

const SCENE = "A lone red fox on a windswept cliff at golden hour, cinematic, 35mm";
const REPAIRED = "images: 1\na red fox like [1]\n---\na grey fox\n---\nimages: 1, 4\na white fox";

test("the final prompt dialog opens after the repair with nothing else paid for, and shows the shared text, the instruction, the list, rows, warnings and notes", async ({ page, generation }) => {
  generation.answerText(() => ({ kind: "text", text: REPAIRED, cost: 0.002 }));
  await setUp(page, generation, "three versions of a fox");
  await stage(page, "in ink");

  expect(generation.chat).toHaveLength(1);
  expect(generation.requests).toHaveLength(0);
  await expect(composer(page)).toBeVisible();
  await expect(dialog(page)).toContainText("3 generations. Nothing has been sent yet.");
  await expect(dialog(page).getByRole("region", { name: "Shared by every run" })).toContainText(SCENE);
  await expect(dialog(page).getByRole("region", { name: "Added after every section" })).toContainText("in ink");
  await expect(sections(page)).toHaveValue(REPAIRED);
  await expect(sections(page)).toHaveAttribute("spellcheck", "false");
  await expect(sections(page)).toHaveAttribute("rows", "12");
  await expect(rows(page)).toHaveText([/Run 1\s*image 1/, /Run 2\s*all images/, /Run 3\s*image 1/]);
  await expect(dialog(page).locator('[data-kind="warning"]')).toHaveText(["no image 4 selected"]);
  await expect(dialog(page).locator('[data-kind="info"]')).toHaveText("re-split into 3 sections");
  await expect(dialog(page).getByRole("button", { name: "Generate 3×" })).toBeEnabled();
});

test("editing the list updates the rows live, and confirm sends the edited batch with the staged batch id, no second text call and nothing written back", async ({ page, generation }) => {
  generation.answerText(() => ({ kind: "text", text: REPAIRED, cost: 0.002 }));
  await setUp(page, generation, "three versions of a fox");
  await stage(page);

  await sections(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n---\na black fox\n---\nimages: 1\n");
  await expect(dialog(page)).toContainText("4 generations. Nothing has been sent yet.");
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(3)).toHaveText(/Run 4\s*all images/);
  await expect(dialog(page).locator('[data-kind="warning"]')).toHaveText(["1 section with no prompt text will not run.", "no image 4 selected"]);

  await dialog(page).getByRole("button", { name: "Generate 4×" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(composer(page)).toHaveCount(0);
  await expect.poll(() => generation.requests.length).toBe(4);
  expect(generation.chat).toHaveLength(1);
  expect(generation.requests.map((request) => request.body.prompt).sort()).toEqual(
    [`${SCENE}\n\na black fox`, `${SCENE}\n\na grey fox`, `${SCENE}\n\na red fox like image 1`, `${SCENE}\n\na white fox`].sort(),
  );

  await expect.poll(async () => (await imageResults(generation)).filter((shape) => shape.props.assetId && !shape.meta.unframed.run).length).toBe(4);
  const results = await imageResults(generation);
  const batchIds = new Set(results.map((shape) => shape.meta.unframed.result.batchId));
  expect(batchIds.size).toBe(1);
  // The staged batch id is the one the repair call recorded.
  const projectDir = join(generation.engine.dataDir, "output", "default");
  const repair = (await readdir(projectDir)).find((name) => /-text-text-to-rewrite/.test(name))!;
  expect(batchIds).toEqual(new Set([JSON.parse(await readFile(join(projectDir, repair), "utf8")).batchId]));
  const sidecars = await Promise.all(
    results.map(async (shape) => JSON.parse((await generation.engine.request(`/api/file/default/${shape.meta.unframed.result.sidecar}`)).text)),
  );
  expect(new Set(sidecars.map((sidecar) => sidecar.batchId))).toEqual(batchIds);
  expect(results.map((shape) => shape.meta.unframed.result.batchExtraCost)).toEqual([0.002, 0.002, 0.002, 0.002]);
  // The source still says what it said.
  expect(plainText((await roomRecords(generation.engine, "default")).find((record) => record.id === "shape:list"))).toBe("three versions of a fox");
});

test("Cancel and Esc send nothing, and a cycle typed into the list disables Generate with its message", async ({ page, generation }) => {
  await setUp(page, generation, "a fox\n---\na wolf");
  await stage(page);
  // A ready list stages with no text call.
  expect(generation.chat).toHaveLength(0);
  await expect(dialog(page)).toContainText("2 generations. Nothing has been sent yet.");
  await expect(dialog(page).getByRole("region", { name: "Added after every section" })).toHaveCount(0);

  await sections(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n---\nagain @301");
  await expect(dialog(page)).toContainText("This list cannot be assembled yet.");
  await expect(dialog(page).getByRole("alert")).toHaveText("Circular reference: 301 -> 301");
  await expect(dialog(page).getByRole("button", { name: /^Generate/ })).toBeDisabled();

  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(composer(page)).toBeVisible();

  await sendButton(page).click();
  await expect(dialog(page)).toBeVisible();
  // The dialog starts again from the list as the pipeline has it.
  await expect(sections(page)).toHaveValue("a fox\n---\na wolf");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(generation.requests).toHaveLength(0);
  expect(generation.chat).toHaveLength(0);
});
