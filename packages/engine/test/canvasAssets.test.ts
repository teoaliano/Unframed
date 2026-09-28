import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageAsset, imageShape, videoAsset } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const pixel = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe("data and blob URLs in the room", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  it("rewrites a data URL asset into a project file with a sidecar within 2 seconds", async () => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    const started = Date.now();
    await tab.put([
      imageAsset("pasted", `data:image/png;base64,${pixel.toString("base64")}`, { name: "Pasted Shot.png" }),
      imageShape("shot", "700", "asset:pasted"),
    ]);
    const src = await tab.waitFor(() => {
      const value = tab.get("asset:pasted")?.props.src as string | undefined;
      return value?.startsWith("project-file:") ? value : undefined;
    }, 2000);
    expect(Date.now() - started).toBeLessThan(2000);
    const file = src.slice("project-file:".length);
    expect(file).toMatch(/^\d+-pasted-shot\.png$/);
    const folder = join(engine.dataDir, "output", "board");
    expect(await readFile(join(folder, file))).toEqual(pixel);
    expect(JSON.parse(await readFile(join(folder, file.replace(/\.png$/, ".json")), "utf8"))).toMatchObject({
      source: "upload",
      fileName: "Pasted Shot.png",
      mime: "image/png",
      bytes: pixel.length,
    });
    expect(tab.get("shape:shot")?.props.assetId).toBe("asset:pasted");
    await tab.close();
  });

  it("clears a blob URL, which cannot be recovered, so the shape shows its empty state", async () => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.put([videoAsset("blobbed", "blob:http://localhost/1234"), imageShape("blob-shape", "701", null)]);
    await tab.waitFor(() => tab.get("asset:blobbed")?.props.src === null, 2000);
    await tab.close();
  });
});

describe("asset markers", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  const push = async (record: ReturnType<typeof imageAsset>) => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    const verdict = await tab.pushRaw([record]);
    await tab.close();
    return verdict;
  };

  it("accepts a project file for images and videos, and an https link for a video", async () => {
    expect(await push(imageAsset("a", "project-file:1789-fox.png"))).toBe("committed");
    expect(await push(videoAsset("b", "project-file:1789-clip.mp4"))).toBe("committed");
    expect(await push(videoAsset("c", "https://cdn.example.com/clip.mp4?sig=1"))).toBe("committed");
    expect(await push(imageAsset("d", null))).toBe("committed");
    expect(await push(imageAsset("e", ""))).toBe("committed");
  });

  it("refuses preset pointers, other schemes, paths in a marker, and links for images", async () => {
    for (const src of [
      "preset-file:board/1789-fox.png",
      "preset-file:/1789-fox.png",
      "http://cdn.example.com/fox.png",
      "javascript:alert(1)",
      "asset:abc",
      "project-file:../other/fox.png",
      "project-file:sub/fox.png",
    ]) {
      expect(await push(imageAsset(`bad-${Math.random()}`, src))).toEqual({ closed: "INVALID_RECORD" });
    }
    expect(await push(imageAsset("linked-image", "https://cdn.example.com/fox.png"))).toEqual({ closed: "INVALID_RECORD" });
  });
});
