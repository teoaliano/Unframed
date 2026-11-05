import type { Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { copySelection, openCanvas, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { audioBytes, audioShapes, expect, filledAudio, test } from "./audio.ts";
import { clickShape } from "./generation.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const pasteSound = (page: Page, name: string) =>
  page.evaluate(
    async ({ base64, name }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: "audio/wav" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { base64: audioBytes(1).toString("base64"), name },
  );

test("a pasted sound file lands at the pointer as an audio shape, or fills every selected audio shape; a nameless one is named by its type", async ({ page, audio }) => {
  const { engine } = audio;
  await openCanvas(page, engine);
  await page.mouse.move(900, 500);
  await pasteSound(page, "take.wav");
  await expect.poll(async () => (await audioShapes(engine)).length).toBe(1);
  const [landed] = await audioShapes(engine);
  expect(landed!.props.fileName).toBe("take.wav");

  await filledAudio(engine, "shape:other", "400", { x: 420, y: 150 }, "other.wav");
  await expect(shapeOnScreen(page, "shape:other").getByTestId("audio-card")).toBeVisible();
  const other = (await shapeOnScreen(page, "shape:other").getByTestId("audio-title").boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.click(other.x + other.width - 4, other.y + 4);
  await page.keyboard.up("Shift");
  await pasteSound(page, "");
  await expect.poll(async () => (await audioShapes(engine)).map((shape) => shape.props.fileName).sort()).toEqual(["pasted-audio.wav", "pasted-audio.wav"]);
  expect((await audioShapes(engine)).length).toBe(2);
});

test("copy and paste keeps the file within a project; across projects the file and the result's recipe are copied", async ({ page, audio }) => {
  const { engine } = audio;
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "alpha" });
  await rpc.call("projects.create", { name: "beta" });
  await rpc.call("preferences.set", { key: "project.active", value: "alpha" });
  await openCanvas(page, engine, "alpha");
  const started = await rpc.call("run.audio", {
    project: "alpha",
    voice: { id: "olivia01", name: "Olivia" },
    params: {},
    selectionPrompt: "A line",
    instruction: "",
    prompt: "A line",
    sources: [],
    anchor: { x: 200, y: 200, w: 10, h: 10 },
  });
  const result = await waitForRoom(engine, "alpha", (records) => records.find((record) => record.id === started.placeholders[0] && record.props?.file !== "" && !record.meta?.unframed?.run));
  await expect(shapeOnScreen(page, result.id).getByTestId("audio-card")).toBeVisible();

  await clickShape(page, result.id);
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");
  const same = await waitForRoom(engine, "alpha", (records) => records.find((record) => record.type === "audio" && record.id !== result.id));
  expect(same.props.file).toBe(result.props.file);

  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("menuitemradio", { name: "beta" }).click();
  await expect(page.locator("[data-canvas-project='beta'] .tl-canvas")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+v");
  const across = await waitForRoom(engine, "beta", (records) => records.find((record) => record.type === "audio"));
  expect(across.props.file).not.toBe(result.props.file);
  const betaFolder = join(engine.dataDir, "output", "beta");
  expect(await readdir(betaFolder)).toContain(across.props.file);
  const sidecar = across.meta.unframed.result.sidecar as string;
  expect(sidecar).toBe(across.props.file.replace(/\.mp3$/, ".json"));
  expect(JSON.parse(await readFile(join(betaFolder, sidecar), "utf8"))).toMatchObject({ kind: "audio", file: across.props.file, recipe: { medium: "audio" } });
});
