import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { agentShapeId } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine } from "./agent.ts";
import { audioBytes, ELEVENLABS_KEY, elevenLabsRoutes } from "./elevenLabsStub.ts";
import { gate } from "./openRouterStub.ts";
import { makeTempDir } from "./harness.ts";
import { outsideLink as outside } from "./outsideCalls.ts";

describe("audio shapes for agents", () => {
  it("file_add brings a sound file in, canvas_write places it, and canvas_read reports it with its file and name", async () => {
    const agent = await startAgentEngine();
    const dir = await makeTempDir("unframed-agent-root-");
    await mkdir(join(dir, "sound"), { recursive: true });
    await writeFile(join(dir, "sound", "Take 1.wav"), audioBytes(1));
    const roots = [pathToFileURL(dir).href];
    const link = await outside(agent);
    const session = await link.open();

    const added = await link.call(session, "file_add", { project: PROJECT, path: "sound/Take 1.wav" }, roots);
    expect(added.isError).toBe(false);
    expect(added.value).toMatchObject({ fileName: "Take 1.wav", kind: "audio", mime: "audio/wav" });
    const file = added.value.file as string;
    expect(file).toMatch(/^\d+-take-1\.wav$/);
    expect(added.value.place).toBe(`canvas_write create with kind "audio" and props.file "${file}"`);

    const placed = await link.call(session, "canvas_write", {
      project: PROJECT,
      ops: [
        { type: "create", id: "new:line", kind: "audio", x: 10, y: 20, props: { file } },
        { type: "create", id: "new:slot", kind: "audio", x: 10, y: 120 },
      ],
    });
    expect(placed.isError).toBe(false);
    const read = await link.call(session, "canvas_read", { project: PROJECT });
    expect(read.value.shapes).toContainEqual(expect.objectContaining({ id: placed.value.ids["new:line"], kind: "audio", x: 10, y: 20, w: 320, h: 64, file, fileName: "Take 1.wav" }));
    const slot = read.value.shapes.find((shape: any) => shape.id === placed.value.ids["new:slot"]);
    expect(slot).toMatchObject({ kind: "audio", w: 240, h: 64, fileName: "" });
    expect("file" in slot).toBe(false);

    const renamed = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "rename", id: placed.value.ids["new:line"], name: "narration" }] });
    expect(renamed.isError).toBe(false);
    const after = await link.call(session, "canvas_read", { project: PROJECT });
    expect(after.value.shapes).toContainEqual(expect.objectContaining({ id: placed.value.ids["new:line"], ref: "narration" }));
  });

  it("refuses props.url and a missing file for audio", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    const byUrl = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "create", id: "new:a", kind: "audio", x: 0, y: 0, props: { url: "https://example.com/a.mp3" } }] });
    expect(byUrl).toMatchObject({ isError: true, value: { error: expect.stringContaining("create: audio takes props.file, a file in the project folder") } });
    const missing = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "create", id: "new:b", kind: "audio", x: 0, y: 0, props: { file: "nope.mp3" } }] });
    expect(missing).toMatchObject({ isError: true, value: { error: expect.stringContaining('create: no file named "nope.mp3" in the project folder') } });
  });

  it("canvas_read reports an audio result with its recipe, and a running one with running", async () => {
    const held = gate<void>();
    let calls = 0;
    const routes = elevenLabsRoutes({
      speech: async () => {
        calls++;
        if (calls === 2) await held.promise;
        return { kind: "audio" };
      },
    });
    const agent = await startAgentEngine({ dotenv: `ELEVENLABS_API_KEY=${ELEVENLABS_KEY}\n`, elevenLabs: routes.handler });
    const rpc = await agent.engine.rpc();
    const request = (prompt: string) => ({
      project: PROJECT,
      voice: { id: "olivia01", name: "Olivia" },
      params: { stability: 0.4 },
      selectionPrompt: prompt,
      instruction: "",
      prompt,
      sources: [],
      anchor: { x: 0, y: 0, w: 10, h: 10 },
    });
    const done = await rpc.call("run.audio", request("Landed line"));
    const landed = async () => ((await rpc.call("testCanvas.read", { project: PROJECT })).records as any[]).find((record) => record.id === done.placeholders[0]);
    for (let tries = 0; tries < 200 && ((await landed())?.props.file ?? "") === ""; tries++) await new Promise((resolve) => setTimeout(resolve, 20));
    const running = await rpc.call("run.audio", request("Running line"));
    const link = await outside(agent);
    const session = await link.open();
    const read = await link.call(session, "canvas_read", { project: PROJECT });
    const result = read.value.shapes.find((shape: any) => shape.id === agentShapeId(done.placeholders[0]!));
    expect(result).toMatchObject({ kind: "audio", file: expect.stringMatching(/-audio-landed-line\.mp3$/), recipe: { medium: "audio", model: "eleven_v4", params: { voice_id: "olivia01", voice_name: "Olivia", stability: 0.4 }, selectionPrompt: "Landed line" } });
    expect(result.running).toBeUndefined();
    expect(read.value.shapes.find((shape: any) => shape.id === agentShapeId(running.placeholders[0]!))).toMatchObject({ kind: "audio", running: true });
    held.release();
  });
});
