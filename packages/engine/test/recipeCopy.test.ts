import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finished, pngBytes, runRequest, startGenerating } from "./generation.ts";

describe("recipe.copy", () => {
  it("copies a result's sidecar and every file its recipe names into another project, renamed to the copies", async () => {
    const generating = await startGenerating();
    const { engine, rpc } = generating;
    await rpc.call("projects.create", { name: "other" });
    const upload = async (name: string) =>
      (await engine.request(`/api/projects/board/files?name=${name}`, { method: "POST", body: pngBytes(12, 12), headers: { "content-type": "image/png" } })).json().file as string;
    const photo = await upload("photo.png");
    const composite = await upload("composite-photo.png");
    const started = await rpc.call(
      "run.image",
      runRequest({
        outputs: [
          {
            prompt: "a fox",
            references: [
              { kind: "image", file: photo },
              { kind: "image", file: composite, original: photo },
              { kind: "video", url: "https://example.com/clip.mp4" },
            ],
          },
        ],
      }),
    );
    await finished(generating.events, started.runId);
    const records = (await rpc.call("testCanvas.read", { project: "board" })).records as any[];
    const result = records.find((record) => record.id === started.placeholders[0]);
    const image = records.find((record) => record.id === result.props.assetId).props.src.replace("project-file:", "");
    const imageCopy = (await rpc.call("files.copy", { project: "other", file: image, from: "board" })).file;

    const { sidecar } = await rpc.call("recipe.copy", { project: "other", from: "board", sidecar: result.meta.unframed.result.sidecar, file: imageCopy });
    expect(sidecar).toBe(imageCopy.replace(/\.png$/, ".json"));
    const copied = JSON.parse(await readFile(join(engine.dataDir, "output", "other", sidecar), "utf8"));
    expect(copied.file).toBe(imageCopy);
    const [first, second, link] = copied.recipe.references;
    expect(first.file).not.toBe(photo);
    expect(second).toEqual({ kind: "image", file: expect.any(String), original: first.file });
    expect(link).toEqual({ kind: "video", url: "https://example.com/clip.mp4" });
    for (const ref of [first, second]) expect(await readFile(join(engine.dataDir, "output", "other", ref.file))).toEqual(pngBytes(12, 12));
    expect(copied.recipe.selectionPrompt).toBe("a lone red fox");

    await expect(rpc.call("recipe.copy", { project: "other", from: "board", sidecar: "missing.json", file: imageCopy })).rejects.toMatchObject({
      code: "not_found",
      message: "This result's recipe is no longer in the project folder.",
    });
    await expect(rpc.call("recipe.copy", { project: "other", from: "board", sidecar: "../x.json", file: imageCopy })).rejects.toMatchObject({ code: "bad_request" });
    await engine.dispose();
  });
});
