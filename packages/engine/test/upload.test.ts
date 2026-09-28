import { chmod, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";

const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

describe("the upload route", () => {
  let engine: TestEngine;
  let folder: string;
  beforeAll(async () => {
    engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "board" });
    folder = join(engine.dataDir, "output", "board");
  });
  afterAll(() => engine.dispose());

  const upload = (name: string, body: Buffer | string, type?: string, project = "board") =>
    engine.request(`/api/projects/${project}/files?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body,
      headers: type === undefined ? {} : { "content-type": type },
    });

  it("saves the bytes as a project file named by time, slug and type, with a sidecar", async () => {
    const before = Date.now();
    const response = await upload("Red Fox.PNG", png, "image/png");
    expect(response.status).toBe(200);
    const answer = response.json();
    expect(answer).toMatchObject({ fileName: "Red Fox.PNG", bytes: png.length, mime: "image/png" });
    const match = /^(\d+)-red-fox\.png$/.exec(answer.file);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(before);
    expect(await readFile(join(folder, answer.file))).toEqual(png);

    const sidecarName = answer.file.replace(/\.png$/, ".json");
    const sidecarText = await readFile(join(folder, sidecarName), "utf8");
    const sidecar = JSON.parse(sidecarText);
    expect(Object.keys(sidecar)).toEqual(["source", "fileName", "mime", "bytes", "at"]);
    expect(sidecar).toMatchObject({ source: "upload", fileName: "Red Fox.PNG", mime: "image/png", bytes: png.length });
    expect(sidecarText).toContain('\n  "source": "upload",');
    expect(Date.parse(sidecar.at)).toBeGreaterThanOrEqual(before - 1000);

    const served = await engine.request(`/api/file/board/${answer.file}`);
    expect(served.status).toBe(200);
    expect(served.body).toEqual(png);
  });

  it("names by type, falls back to the name's extension, and uses upload when the name slugs to nothing", async () => {
    expect((await upload("clip", "x", "video/quicktime")).json().file).toMatch(/^\d+-clip\.mov$/);
    expect((await upload("page.htm", "<p>hi</p>", "text/html; charset=utf-8")).json()).toMatchObject({ file: expect.stringMatching(/^\d+-page\.html$/), mime: "text/html" });
    expect((await upload("scan.TIFF", "x", "application/octet-stream")).json().file).toMatch(/^\d+-scan\.tiff$/);
    expect((await upload("???.toolong", "x")).json().file).toMatch(/^\d+-upload\.bin$/);
  });

  it("adds -1, -2 when two uploads of one name land in the same millisecond", async () => {
    const answers = await Promise.all([upload("twin.png", png, "image/png"), upload("twin.png", png, "image/png"), upload("twin.png", png, "image/png")]);
    const files = answers.map((response) => response.json().file as string);
    expect(new Set(files).size).toBe(3);
    for (const file of files) expect(file).toMatch(/^\d+-twin(-\d)?\.png$/);
  });

  it("writes a composite's or a sketch's sidecar with its source, original, marks and crop", async () => {
    const crop = { topLeft: { x: 0.1, y: 0 }, bottomRight: { x: 1, y: 0.5 } };
    const composite = await engine.request(
      `/api/projects/board/files?name=composite-1-fox.png&source=composite&of=1-fox.png&marks=${encodeURIComponent(JSON.stringify(["shape:m1", "shape:m2"]))}&crop=${encodeURIComponent(JSON.stringify(crop))}`,
      { method: "POST", body: png, headers: { "content-type": "image/png" } },
    );
    expect(composite.status).toBe(200);
    const compositeFile = composite.json().file as string;
    expect(compositeFile).toMatch(/^\d+-composite-1-fox\.png$/);
    const compositeSidecar = JSON.parse(await readFile(join(folder, compositeFile.replace(/\.png$/, ".json")), "utf8"));
    expect(Object.keys(compositeSidecar)).toEqual(["source", "fileName", "mime", "bytes", "at", "of", "marks", "crop"]);
    expect(compositeSidecar).toMatchObject({ source: "composite", fileName: "composite-1-fox.png", of: "1-fox.png", marks: ["shape:m1", "shape:m2"], crop });

    const sketch = await engine.request(`/api/projects/board/files?name=sketch.png&source=sketch&marks=${encodeURIComponent(JSON.stringify(["shape:m3"]))}`, {
      method: "POST",
      body: png,
      headers: { "content-type": "image/png" },
    });
    const sketchSidecar = JSON.parse(await readFile(join(folder, (sketch.json().file as string).replace(/\.png$/, ".json")), "utf8"));
    expect(Object.keys(sketchSidecar)).toEqual(["source", "fileName", "mime", "bytes", "at", "marks", "crop"]);
    expect(sketchSidecar).toMatchObject({ source: "sketch", fileName: "sketch.png", marks: ["shape:m3"], crop: null });
  });

  it("refuses a composite sidecar it cannot read", async () => {
    for (const query of ["source=paste", "source=composite&marks=not-json", "source=composite&of=../x.png&marks=[]", "source=sketch&marks=[1]"]) {
      const response = await engine.request(`/api/projects/board/files?name=refused.png&${query}`, { method: "POST", body: png, headers: { "content-type": "image/png" } });
      expect(response.status).toBe(400);
      expect(response.json()).toEqual({ error: "That is not a composite or sketch upload." });
    }
  });

  it("answers 400 for an empty body", async () => {
    const response = await upload("empty.png", Buffer.alloc(0), "image/png");
    expect(response.status).toBe(400);
    expect(response.json()).toEqual({ error: "No file bytes in the request body." });
  });

  it("answers 413 for a body declared over 500 MB, before reading it", async () => {
    const response = await engine.request("/api/projects/board/files?name=huge.png", {
      method: "POST",
      headers: { "content-type": "image/png", "content-length": String(500 * 1_048_576 + 1) },
      body: "",
    });
    expect(response.status).toBe(413);
  });

  it("answers 500 with the reason when the file cannot be saved", async () => {
    await chmod(folder, 0o500);
    try {
      const response = await upload("locked.png", png, "image/png");
      expect(response.status).toBe(500);
      expect(response.json().error).toMatch(/^Could not save the file: /);
    } finally {
      await chmod(folder, 0o700);
    }
  });

  it("answers 404 for a project that does not exist, and applies the loopback guard", async () => {
    expect((await upload("x.png", png, "image/png", "nowhere")).status).toBe(404);
    const refused = await engine.request("/api/projects/board/files?name=x.png", {
      method: "POST",
      body: png,
      headers: { origin: "https://evil.example" },
    });
    expect(refused.status).toBe(403);
    expect((await readdir(folder)).some((name) => name.includes("-x."))).toBe(false);
  });
});
