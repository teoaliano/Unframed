import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";

describe("files.copy", () => {
  let engine: TestEngine;
  const folder = (project: string) => join(engine.dataDir, "output", project);
  beforeAll(async () => {
    engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "one" });
    await rpc.call("projects.create", { name: "two" });
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

  it("copies a file within a project with a copy sidecar naming the source", async () => {
    const source = await upload("one", "Landing.html", "<h1>hi</h1>", "text/html");
    const { file } = await (await engine.rpc()).call("files.copy", { project: "one", file: source });
    expect(file).not.toBe(source);
    expect(file).toMatch(/^\d+-landing\.html$/);
    expect(await readFile(join(folder("one"), file), "utf8")).toBe("<h1>hi</h1>");
    const sidecar = JSON.parse(await readFile(join(folder("one"), file.replace(/\.html$/, ".json")), "utf8"));
    expect(sidecar).toMatchObject({ source: "copy", fileName: source.replace(/^\d+-/, ""), mime: "text/html", bytes: 11, of: source });
    expect(Object.keys(sidecar)).toEqual(["source", "fileName", "mime", "bytes", "at", "of"]);
  });

  it("copies a file from another project into this one", async () => {
    const source = await upload("one", "fox.png", "png-bytes", "image/png");
    const { file } = await (await engine.rpc()).call("files.copy", { project: "two", file: source, from: "one" });
    expect(await readFile(join(folder("two"), file), "utf8")).toBe("png-bytes");
    expect(JSON.parse(await readFile(join(folder("two"), file.replace(/\.png$/, ".json")), "utf8"))).toMatchObject({
      source: "copy",
      fileName: "fox.png",
      mime: "image/png",
      of: source,
    });
  });

  it("takes octet-stream as the type when the source has no sidecar", async () => {
    await writeFile(join(folder("one"), "loose.webm"), "clip");
    const { file } = await (await engine.rpc()).call("files.copy", { project: "one", file: "loose.webm" });
    expect(file).toMatch(/^\d+-loose\.webm$/);
    expect(JSON.parse(await readFile(join(folder("one"), file.replace(/\.webm$/, ".json")), "utf8"))).toMatchObject({
      fileName: "loose.webm",
      mime: "application/octet-stream",
    });
  });

  it("refuses anything but a bare file name in the source project", async () => {
    const rpc = await engine.rpc();
    for (const file of ["../two/x.png", "sub/x.png", "..", ""]) {
      await expect(rpc.call("files.copy", { project: "one", file })).rejects.toMatchObject({
        code: "bad_request",
        message: "That is not a file in this project.",
      });
    }
    await expect(rpc.call("files.copy", { project: "one", file: "x.png", from: "nowhere" })).rejects.toMatchObject({
      code: "bad_request",
      message: "That is not a file in this project.",
    });
  });

  it("answers not_found for a missing file", async () => {
    await expect((await engine.rpc()).call("files.copy", { project: "one", file: "1-gone.png" })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringMatching(/^Could not copy the file: /),
    });
  });
});
