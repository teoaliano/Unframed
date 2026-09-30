import { chmod, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyCanvasPoint, openCanvas, roomRecords, toast, waitForRoom, type AnyRecord } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { dropFiles } from "./media.ts";

const clipPath = fileURLToPath(new URL("./media/clip.webm", import.meta.url));

const centreOf = (record: AnyRecord) => ({ x: record.x! + record.props.w / 2, y: record.y! + record.props.h / 2 });

test.describe("dropping files on the canvas", () => {
  test("images, a clip and an .html page land at the drop point, each 24 px on from the last; other files are ignored", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const point = await emptyCanvasPoint(page);
    const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
    await dropFiles(page, point, [
      { name: "first.png", mime: "image/png", bytes: pngBytes(400, 200) },
      { name: "notes.txt", mime: "text/plain", bytes: Buffer.from("ignored") },
      { name: "second.png", mime: "image/png", bytes: pngBytes(300, 300, 9) },
      { name: "waves.webm", mime: "video/webm", bytes: await readFile(clipPath) },
      { name: "Landing Page.html", mime: "text/html", bytes: Buffer.from("<h1>Hello</h1>") },
    ]);
    const added = await waitForRoom(engine, "default", (records) => {
      const shapes = records.filter((record) => record.typeName === "shape" && !before.has(record.id));
      return shapes.length === 4 ? shapes : undefined;
    });
    const byType = (type: string) => added.filter((record) => record.type === type);
    expect(byType("image")).toHaveLength(2);
    expect(byType("video")).toHaveLength(1);
    const pageShape = byType("page")[0]!;
    expect(pageShape.props).toMatchObject({ w: 480, h: 320, fileName: "Landing Page.html", title: "Landing Page" });
    expect(pageShape.props.file).toMatch(/^\d+-landing-page\.html$/);
    expect(await readFile(join(engine.dataDir, "output", "default", pageShape.props.file), "utf8")).toBe("<h1>Hello</h1>");

    const records = await roomRecords(engine, "default");
    const assetName = (shape: AnyRecord) => records.find((record) => record.id === shape.props.assetId)?.props.name;
    const ordered = [
      byType("image").find((shape) => assetName(shape) === "first.png")!,
      byType("image").find((shape) => assetName(shape) === "second.png")!,
      byType("video")[0]!,
      pageShape,
    ];
    const centres = ordered.map(centreOf);
    for (let index = 1; index < centres.length; index++) {
      expect(centres[index]!.x - centres[0]!.x).toBeCloseTo(index * 24, 0);
      expect(centres[index]!.y - centres[0]!.y).toBeCloseTo(index * 24, 0);
    }
    expect(ordered[0]!.props).toMatchObject({ w: 240, h: 120 });
    expect(ordered[2]!.props.w).toBe(240);
    expect((await readdir(join(engine.dataDir, "output", "default"))).some((name) => name.includes("notes"))).toBe(false);
  });

  test("a clip over 25 MB is refused with a toast, and a failed upload says which file", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const point = await emptyCanvasPoint(page);
    await dropFiles(page, point, [{ name: "huge.mp4", mime: "video/mp4", size: 26_214_401 }]);
    await expect(toast(page, "Video is too large. Keep it under 25MB.")).toBeVisible();

    const folder = join(engine.dataDir, "output", "default");
    await chmod(folder, 0o500);
    try {
      await dropFiles(page, point, [{ name: "fox.png", mime: "image/png", bytes: pngBytes(64, 64) }]);
      await expect(toast(page, /^Could not add fox\.png: Could not save the file: /)).toBeVisible();
    } finally {
      await chmod(folder, 0o700);
    }
    expect((await roomRecords(engine, "default")).filter((record) => record.type === "image" || record.type === "video")).toEqual([]);
  });
});
