import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { emptyMedia, putRecords } from "./media.ts";

export const clipPath = fileURLToPath(new URL("./media/clip.webm", import.meta.url));

test.describe("an empty video", () => {
  test("fills from a file picked in its empty state, keeping its width with the clip's aspect", async ({ page, engine }) => {
    await openCanvas(page, engine);
    await putRecords(engine, [emptyMedia("shape:empty-video", "video", "150", { x: 440, y: 120 })]);
    const shape = shapeOnScreen(page, "shape:empty-video");
    await expect(shape.locator("[data-shape-label]")).toHaveText("Video");
    const chooser = page.waitForEvent("filechooser");
    await shape.getByRole("button", { name: "Choose file" }).click();
    const picker = await chooser;
    expect(await picker.element().getAttribute("accept")).toBe("video/*");
    await picker.setFiles({ name: "clip.webm", mimeType: "video/webm", buffer: await readFile(clipPath) });
    const filled = await waitForRoom(engine, "default", (records) => {
      const record = records.find((each) => each.id === "shape:empty-video");
      return record?.props.assetId ? record : undefined;
    });
    expect(filled.props.w).toBe(240);
    expect(filled.props.h).toBeCloseTo(135, 0);
    const clip = shape.locator("video");
    await expect(clip).toHaveAttribute("src", /^\/api\/file\/default\/\d+-clip\.webm$/);
    expect(await clip.evaluate((element: HTMLVideoElement) => ({ controls: element.controls, muted: element.muted, preload: element.preload }))).toEqual({
      controls: false,
      muted: true,
      preload: "metadata",
    });
  });

  test("refuses a clip over 25 MB with a plain message and uploads nothing", async ({ page, engine }) => {
    await openCanvas(page, engine);
    await putRecords(engine, [emptyMedia("shape:big-video", "video", "151", { x: 440, y: 120 })]);
    const shape = shapeOnScreen(page, "shape:big-video");
    const chooser = page.waitForEvent("filechooser");
    await shape.getByRole("button", { name: "Choose file" }).click();
    await (await chooser).setFiles({ name: "huge.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(26_214_401) });
    await expect(shape.getByRole("alert")).toHaveText("Video is too large. Keep it under 25MB.");
    expect((await readdir(join(engine.dataDir, "output", "default"))).some((name) => name.includes("huge"))).toBe(false);
    expect((await roomRecords(engine, "default")).find((record) => record.id === "shape:big-video")!.props.assetId).toBeNull();
  });

  test("takes an https link through Use link, named by its last path segment, and explains a link it cannot use", async ({ page, engine }) => {
    await openCanvas(page, engine);
    await putRecords(engine, [emptyMedia("shape:linked", "video", "152", { x: 440, y: 120 })]);
    const shape = shapeOnScreen(page, "shape:linked");
    const field = shape.getByPlaceholder("or paste an https:// link");
    const use = shape.getByRole("button", { name: "Use link" });

    await field.fill("ftp://files.example.com/fox.mp4");
    await expect(use).toHaveCount(0);
    await field.press("Enter");
    await expect(shape.getByRole("alert")).toHaveText("Paste a full https:// link to a video file.");

    await field.fill("https://");
    await expect(use).toHaveCount(0);
    await field.fill("https://cdn.example.com/clips/fox%20run.mp4?sig=abc");
    await use.click();
    const filled = await waitForRoom(engine, "default", (records) => {
      const record = records.find((each) => each.id === "shape:linked");
      return record?.props.assetId ? record : undefined;
    });
    const asset = (await roomRecords(engine, "default")).find((record) => record.id === filled.props.assetId)!;
    expect(asset.props).toMatchObject({ src: "https://cdn.example.com/clips/fox%20run.mp4?sig=abc", name: "fox run.mp4" });
    await expect(shape.locator("video")).toHaveAttribute("src", "https://cdn.example.com/clips/fox%20run.mp4?sig=abc");
  });
});
