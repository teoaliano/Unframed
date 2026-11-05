import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audioBytes } from "./elevenLabsStub.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const audioShape = (id: string, props: Record<string, unknown>): TLRecord =>
  ({
    id: `shape:${id}`,
    typeName: "shape",
    type: "audio",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    props: { w: 320, h: 64, file: "", fileName: "", ...props },
    meta: { ref: id },
  }) as unknown as TLRecord;

describe("audio shapes and files", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  const push = async (record: TLRecord) => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    const verdict = await tab.pushRaw([record]);
    await tab.close();
    return verdict;
  };

  it("serves the audio shape's migration sequence, keeps one naming a project file, and refuses one whose file is a path", async () => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    expect(Object.keys(tab.received.find((message) => message.type === "connect")?.schema?.sequences ?? {})).toContain("com.tldraw.shape.audio");
    await tab.close();
    expect(await push(audioShape("a-ok", { file: "1-line.mp3", fileName: "line.mp3" }))).toBe("committed");
    expect(await push(audioShape("a-empty", {}))).toBe("committed");
    expect(await push(audioShape("a-path", { file: "../secret.mp3" }))).toEqual({ closed: "INVALID_RECORD" });
  });

  it.each([
    ["audio/mpeg", "line.mp3", "mp3"],
    ["audio/wav", "line.wav", "wav"],
    ["audio/mp4", "line.m4a", "m4a"],
  ])("names a %s upload .%s, writes its sidecar, and serves it with its type and byte ranges", async (mime, name, ext) => {
    const bytes = audioBytes(1);
    const response = await engine.request(`/api/projects/board/files?name=${name}`, { method: "POST", body: bytes, headers: { "content-type": mime } });
    expect(response.status).toBe(200);
    const answer = response.json();
    expect(answer.file).toMatch(new RegExp(`^\\d+-line\\.${ext}$`));
    const sidecar = JSON.parse(await readFile(join(engine.dataDir, "output", "board", answer.file.replace(/\.\w+$/, ".json")), "utf8"));
    expect(sidecar).toMatchObject({ source: "upload", fileName: name, mime, bytes: bytes.length });
    const served = await engine.request(`/api/file/board/${answer.file}`);
    expect(served.headers["content-type"]).toBe(ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/mp4");
    const part = await engine.request(`/api/file/board/${answer.file}`, { headers: { range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(part.body).toEqual(bytes.subarray(10, 20));
  });
});
