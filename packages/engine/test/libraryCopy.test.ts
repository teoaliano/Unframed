import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";

describe("library.copyFiles", () => {
  let engine: TestEngine;
  const folder = (project: string) => join(engine.dataDir, "output", project);
  const sidecarOf = async (project: string, file: string) => JSON.parse(await readFile(join(folder(project), file.replace(/\.[^.]+$/, ".json")), "utf8"));

  beforeAll(async () => {
    engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "shoots" });
    await rpc.call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  const upload = async (project: string, name: string, body: string, type: string) =>
    (
      await engine.request(`/api/projects/${project}/files?name=${encodeURIComponent(name)}`, {
        method: "POST",
        body,
        headers: { "content-type": type },
      })
    ).json().file as string;

  it("copies each file into the target project with a sidecar naming the file and project it came from", async () => {
    const fox = await upload("shoots", "fox.png", "fox-bytes", "image/png");
    const [copied] = await (await engine.rpc()).call("library.copyFiles", { project: "board", files: [{ project: "shoots", file: fox }] });
    expect(copied).toEqual({ file: expect.stringMatching(/^\d+-fox\.png$/) });
    const file = (copied as { file: string }).file;
    expect(await readFile(join(folder("board"), file), "utf8")).toBe("fox-bytes");
    const sidecar = await sidecarOf("board", file);
    expect(sidecar).toEqual({ source: "copy", fileName: "fox.png", mime: "image/png", bytes: 9, at: expect.any(String), of: fox, ofProject: "shoots" });
    expect(Object.keys(sidecar)).toEqual(["source", "fileName", "mime", "bytes", "at", "of", "ofProject"]);
  });

  it("copies within one project too, and reads an empty project as the target", async () => {
    const clip = await upload("board", "waves.mp4", "clip", "video/mp4");
    const copies = await (await engine.rpc()).call("library.copyFiles", {
      project: "board",
      files: [
        { project: "board", file: clip },
        { project: "", file: clip },
      ],
    });
    const names = copies.map((copy) => (copy as { file: string }).file);
    expect(new Set([clip, ...names]).size).toBe(3);
    for (const name of names) {
      expect(await readFile(join(folder("board"), name), "utf8")).toBe("clip");
      expect(await sidecarOf("board", name)).toMatchObject({ of: clip, ofProject: "board" });
    }
  });

  it("answers missing, in place, for a file or a project that is gone", async () => {
    const kept = await upload("shoots", "kept.png", "kept", "image/png");
    const answers = await (await engine.rpc()).call("library.copyFiles", {
      project: "board",
      files: [
        { project: "shoots", file: "1700000000000-gone.png" },
        { project: "shoots", file: kept },
        { project: "renamed-away", file: kept },
      ],
    });
    expect(answers).toEqual([{ missing: true }, { file: expect.stringMatching(/-kept\.png$/) }, { missing: true }]);
  });

  it("refuses anything but a bare file name, copying nothing", async () => {
    const rpc = await engine.rpc();
    for (const file of ["../shoots/x.png", "sub/x.png", "..", "", "a\\b.png"]) {
      await expect(rpc.call("library.copyFiles", { project: "board", files: [{ project: "shoots", file }] })).rejects.toMatchObject({
        code: "bad_request",
        message: "That is not a file in this project.",
      });
    }
  });

  it("refuses a target project that does not exist", async () => {
    await expect((await engine.rpc()).call("library.copyFiles", { project: "nowhere", files: [] })).rejects.toMatchObject({ code: "not_found" });
  });
});
