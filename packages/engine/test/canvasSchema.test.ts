import type { TLRecord } from "@tldraw/tlschema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupShape, pageShape, promptShape, videoShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

/** Pushes one record as a tab and reports whether the room kept it. */
const pushOne = async (engine: TestEngine, record: TLRecord) => {
  const tab = await connectTab(engine.port, "board");
  await tab.loaded;
  const verdict = await tab.pushRaw([record]);
  await tab.close();
  return verdict;
};

const stored = async (engine: TestEngine, id: string) => {
  const reader = await connectTab(engine.port, "board");
  await reader.loaded;
  const record = reader.get(id);
  await reader.close();
  return record;
};

describe("the canvas schema in the room", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  it("serves the Unframed shapes and their migration sequences to every tab", async () => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    const connect = tab.received.find((message) => message.type === "connect");
    const sequences = Object.keys(connect?.schema?.sequences ?? {});
    expect(sequences).toEqual(expect.arrayContaining(["com.tldraw.shape.page", "com.tldraw.shape.motion", "com.tldraw.shape.text", "com.tldraw.shape.frame"]));
    expect(sequences).not.toContain("com.tldraw.shape.embed");
    expect(sequences).not.toContain("com.tldraw.shape.bookmark");
    await tab.close();
  });

  it("keeps valid prompts, videos, groups, pages and motions", async () => {
    const records = [
      promptShape("p", "100", "a fox", {}, { sized: true, unframed: { note: 1 } }),
      videoShape("v", "101", null),
      groupShape("g", "hero-shots"),
      pageShape("pg", "102", { file: "1-landing.html", title: "landing", fileName: "landing.html" }),
      { ...pageShape("m", "103", { dials: { speed: 2 } }), type: "motion" } as TLRecord,
    ];
    for (const record of records) expect(await pushOne(engine, record)).toBe("committed");
    expect(await stored(engine, "shape:m")).toMatchObject({ type: "motion", props: { dials: { speed: 2 } } });
  });

  it("refuses a prompt with no ref, a page whose file is a path, a meta field outside meta.unframed and an embed", async () => {
    const withoutRef = { ...promptShape("no-ref", "1", "x"), meta: {} } as TLRecord;
    const pathFile = pageShape("bad-file", "104", { file: "../escape.html" });
    const strayMeta = promptShape("stray", "105", "x", {}, { colour: "red" });
    const embed = { ...pageShape("embed", "106"), type: "embed", props: { w: 10, h: 10, url: "https://x.example" } } as unknown as TLRecord;
    for (const record of [withoutRef, pathFile, strayMeta, embed]) {
      expect(await pushOne(engine, record)).toEqual({ closed: "INVALID_RECORD" });
      expect(await stored(engine, record.id)).toBeUndefined();
    }
  });
});
