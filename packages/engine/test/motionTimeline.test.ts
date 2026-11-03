import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

const SAMPLE = readFileSync(join(import.meta.dirname, "../../../assets/fixtures/motion-samples/01-literal-two-clips.html"), "utf8");
const NO_SCRIPT = '<html><body><div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"></div></body></html>';
const UNREADABLE = '<html><body><div id="root" data-composition-id="main" data-start="0" data-duration="2"></div><script>window.__timelines.main = gsap.timeline({ paused: true }); window.__timelines.main.to("#a", {x: ;</script></body></html>';

const start = async () => {
  const engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "board" });
  const folder = join(engine.dataDir, "output", "board");
  return { rpc, folder };
};

describe("motion.timeline", () => {
  it("answers the reading of a motion file in the project, and the same answer again", async () => {
    const { rpc, folder } = await start();
    await writeFile(join(folder, "1-intro.html"), SAMPLE);
    const reading = await rpc.call("motion.timeline", { project: "board", file: "1-intro.html" });
    expect(reading.file).toBe("1-intro.html");
    expect(reading.script).toBe("ok");
    expect(reading.length).toEqual({ kind: "source", value: 4 });
    expect(reading.clips.map((clip: { id: string }) => clip.id)).toEqual(["intro", "outro"]);
    expect(reading.tweens).toHaveLength(2);
    expect(reading.tweens[0]!.start).toEqual({ kind: "source", value: 0.2 });
    expect(reading.tweens[0]!.duration).toEqual({ kind: "source", value: 0.8 });
    expect(reading.clips[0]!.carry).toEqual({ tweens: [{ index: 0, id: reading.tweens[0]!.ref.id }], dials: [] });
    expect(await rpc.call("motion.timeline", { project: "board", file: "1-intro.html" })).toEqual(reading);
  });

  it("answers none for a motion with no timeline script, and unreadable for one that does not parse", async () => {
    const { rpc, folder } = await start();
    await writeFile(join(folder, "2-plain.html"), NO_SCRIPT);
    await writeFile(join(folder, "3-broken.html"), UNREADABLE);
    expect(await rpc.call("motion.timeline", { project: "board", file: "2-plain.html" })).toMatchObject({ script: "none", tweens: [] });
    expect(await rpc.call("motion.timeline", { project: "board", file: "3-broken.html" })).toMatchObject({ script: "unreadable", tweens: [] });
  });

  it("refuses a missing file name and a file that is not in the project", async () => {
    const { rpc } = await start();
    await expect(rpc.call("motion.timeline", { project: "board", file: "" })).rejects.toMatchObject({
      code: "bad_request",
      message: "Which composition? Pass its .html file name.",
    });
    await expect(rpc.call("motion.timeline", { project: "board", file: "nope.html" })).rejects.toMatchObject({
      code: "not_found",
      message: "No file nope.html in this project.",
    });
    await expect(rpc.call("motion.timeline", { project: "board", file: "../board/1-intro.html" })).rejects.toMatchObject({ code: "not_found" });
  });
});
