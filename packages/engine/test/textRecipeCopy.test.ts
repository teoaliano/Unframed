import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finished, pngBytes } from "./generation.ts";
import { roomShapes, startTexting, upload } from "./texting.ts";

describe("recipe.copy for a text result", () => {
  it("copies the text sidecar and the files its recipe names into another project, never over another file", async () => {
    const texting = await startTexting();
    const { engine, rpc } = texting;
    await rpc.call("projects.create", { name: "other" });
    const photo = await upload(texting, "photo.png", pngBytes(12, 12), "image/png");
    const started = await rpc.call("run.text", {
      project: "board",
      selectionPrompt: "a fox",
      instruction: "describe it",
      prompt: "a fox\n\ndescribe it",
      references: [{ kind: "image", file: photo }],
      sources: [],
      anchor: { x: 0, y: 0, w: 10, h: 10 },
    });
    await finished(texting.events, started.runId);
    const result = (await roomShapes(texting)).find((shape) => shape.id === started.placeholders[0]);
    const name: string = result.meta.unframed.result.sidecar;

    // A text result's only file is its sidecar, so that is the file the copy is named after.
    const { sidecar } = await rpc.call("recipe.copy", { project: "other", from: "board", sidecar: name, file: name });
    expect(sidecar).toBe(name);
    const otherDir = join(engine.dataDir, "output", "other");
    const copied = JSON.parse(await readFile(join(otherDir, sidecar), "utf8"));
    expect(copied).toMatchObject({ kind: "text", result: "a fox on a cliff", prompt: "a fox\n\ndescribe it" });
    expect("file" in copied).toBe(false);
    const [ref] = copied.recipe.references;
    expect(ref.file).not.toBe(photo);
    expect(await readFile(join(otherDir, ref.file))).toEqual(pngBytes(12, 12));

    const again = await rpc.call("recipe.copy", { project: "other", from: "board", sidecar: name, file: name });
    expect(again.sidecar).toBe(name.replace(/\.json$/, "-2.json"));
    expect((await readdir(otherDir)).filter((each) => each.startsWith(name.replace(/\.json$/, "")))).toHaveLength(2);
    await engine.dispose();
  });
});
