import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refOf, textOf } from "./canvasRecords.ts";
import { makeTempDir, repoRoot, startEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const starterTexts = async () => {
  const text = await readFile(join(repoRoot, "assets/prompts/starter-canvas.md"), "utf8");
  const subject = /Subject prompt, text: `([^`]+)`/.exec(text)?.[1];
  const scene = /Scene prompt, above it, text: `([^`]+)`/.exec(text)?.[1];
  if (!subject || !scene) throw new Error("starter-canvas.md no longer has the two prompt texts");
  return { subject, scene };
};

describe("starter content", () => {
  it("gives a new project's canvas the two starter prompts, the scene referencing the subject", async () => {
    const dataDir = await makeTempDir();
    const engine = await startEngine({ dataDir });
    await (await engine.rpc()).call("projects.create", { name: "Fresh" });
    const tab = await connectTab(engine.port, "fresh");
    await tab.loaded;
    const { subject, scene } = await starterTexts();

    const prompts = tab.records().filter((record) => record.typeName === "shape");
    expect(prompts).toHaveLength(2);
    expect(tab.get("shape:starter-subject")).toMatchObject({ type: "text", x: 40, y: 320, meta: { ref: "100" } });
    expect(tab.get("shape:starter-scene")).toMatchObject({ type: "text", x: 40, y: 60, meta: { ref: "101" } });
    expect(textOf(tab.get("shape:starter-subject"))).toBe(subject);
    expect(textOf(tab.get("shape:starter-scene"))).toBe(scene.replace("@<subject id>", "@100"));
    expect(refOf(tab.get("shape:starter-scene"))).toBe("101");
    await tab.close();

    await engine.stop();
    const again = await startEngine({ dataDir });
    const later = await connectTab(again.port, "fresh");
    await later.loaded;
    expect(later.records().filter((record) => record.typeName === "shape")).toHaveLength(2);
    await later.close();
  });

  it("seeds a project whose canvas was never opened, and never seeds one that has a canvas", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.remove(["shape:starter-scene", "shape:starter-subject"]);
    await tab.close();
    const next = await connectTab(engine.port, "board");
    await next.loaded;
    expect(next.records().filter((record) => record.typeName === "shape")).toEqual([]);
    await next.close();
  });
});
