import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TextRunRequest } from "@unframed/contracts";
import { plainText } from "@unframed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, finished, pngBytes, until } from "./generation.ts";
import { gate } from "./openRouterStub.ts";
import { folderOf, readSidecar, roomShapes, startTexting, textSidecars, upload, type Texting } from "./texting.ts";

const DEFAULT_TEXT_MODEL = "google/gemini-3.5-flash-lite";

const textRequest = (overrides: Partial<TextRunRequest> = {}): TextRunRequest => ({
  project: "board",
  selectionPrompt: "a lone red fox",
  instruction: "",
  prompt: "a lone red fox",
  references: [],
  sources: [],
  anchor: { x: 1000, y: 0, w: 100, h: 100 },
  ...overrides,
});

describe("run.text", () => {
  let texting: Texting;
  beforeAll(async () => {
    texting = await startTexting();
  });
  afterAll(() => texting.engine.dispose());

  it("answers once an empty text result is in the room, then fills it with the answer", async () => {
    const photo = await upload(texting, "photo.png", pngBytes(8, 8), "image/png");
    const held = gate<void>();
    texting.answerText(async () => {
      await held.promise;
      return { kind: "text", text: "A fox on a cliff.\n\nIt watches @100.", cost: 0.0012 };
    });

    const started = await texting.rpc.call(
      "run.text",
      textRequest({
        model: "openai/gpt-5",
        selectionPrompt: "a lone red fox",
        instruction: "describe it",
        prompt: "a lone red fox\n\ndescribe it",
        references: [{ kind: "image", file: photo }],
        sources: ["shape:starter-subject"],
        anchor: { x: 40, y: 60, w: 320, h: 300 },
      }),
    );
    expect(started.batchId).toMatch(/^b-\d+$/);
    expect(started.placeholders).toHaveLength(1);

    const placeholder = (await roomShapes(texting)).find((shape) => shape.id === started.placeholders[0]);
    expect(placeholder).toMatchObject({
      type: "text",
      meta: {
        ref: "102",
        unframed: {
          run: { runId: started.runId, runIndex: 1, startedAt: expect.any(Number) },
          result: {
            sidecar: null,
            medium: "text",
            model: "openai/gpt-5",
            batchId: started.batchId,
            runIndex: 1,
            runCount: 1,
            cost: null,
            sources: ["shape:starter-subject"],
          },
        },
      },
    });
    expect(plainText(placeholder.props.richText)).toBe("");
    expect(placeholder.x).toBeGreaterThanOrEqual(40 + 320 + 40);
    expect(placeholder.y).toBe(60);

    await until(() => (texting.chat.length === 1 ? true : undefined), "the upstream call");
    expect(texting.chat[0]!.body.messages[0].content).toEqual([
      { type: "text", text: "a lone red fox\n\ndescribe it" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${pngBytes(8, 8).toString("base64")}` } },
    ]);
    held.release();
    const done = await finished(texting.events, started.runId);
    expect(done).toEqual({ type: "finished", runId: started.runId, succeeded: 1, failed: 0, errors: [], orphaned: 0 });

    const [sidecarName] = await textSidecars(texting);
    expect(eventsOf(texting.events, started.runId)).toEqual([
      { type: "started", runId: started.runId, batchId: started.batchId, count: 1 },
      { type: "output", runId: started.runId, runIndex: 1, ok: true, shapeId: started.placeholders[0], file: sidecarName, cost: 0.0012 },
      done,
    ]);

    const filled = (await roomShapes(texting)).find((shape) => shape.id === started.placeholders[0]);
    expect(plainText(filled.props.richText)).toBe("A fox on a cliff.\n\nIt watches @100.");
    expect(filled.meta.unframed.run).toBeUndefined();
    expect(filled.meta.unframed.result).toEqual({
      sidecar: sidecarName,
      medium: "text",
      model: "openai/gpt-5",
      batchId: started.batchId,
      runIndex: 1,
      runCount: 1,
      cost: 0.0012,
      sources: ["shape:starter-subject"],
    });

    const sidecar = await readSidecar(texting, sidecarName!);
    expect(sidecar).toEqual({
      kind: "text",
      prompt: "a lone red fox\n\ndescribe it",
      model: "openai/gpt-5",
      result: "A fox on a cliff.\n\nIt watches @100.",
      referenceCount: 1,
      references: { images: 1, videos: 0 },
      batchId: started.batchId,
      cost: 0.0012,
      createdAt: expect.any(String),
      recipe: {
        medium: "text",
        model: "openai/gpt-5",
        params: {},
        selectionPrompt: "a lone red fox",
        instruction: "describe it",
        references: [{ kind: "image", file: photo }],
        sources: ["shape:starter-subject"],
      },
    });
    expect(await texting.rpc.call("recipe.read", { project: "board", shapeId: started.placeholders[0]! })).toEqual(sidecar.recipe);
  });

  it("uses the default text model and records the result it came from", async () => {
    texting.answerText(() => ({ kind: "text", text: "first answer" }));
    const first = await texting.rpc.call("run.text", textRequest({ prompt: "first" }));
    await finished(texting.events, first.runId);
    texting.answerText(() => ({ kind: "text", text: "second answer" }));
    const second = await texting.rpc.call("run.text", textRequest({ prompt: "first", of: { shapeId: first.placeholders[0]!, action: "regenerate" } }));
    await finished(texting.events, second.runId);
    expect(texting.chat.at(-1)!.body.model).toBe(DEFAULT_TEXT_MODEL);
    const shapes = await roomShapes(texting);
    const firstSidecar = shapes.find((shape) => shape.id === first.placeholders[0]).meta.unframed.result.sidecar;
    const secondShape = shapes.find((shape) => shape.id === second.placeholders[0]);
    expect((await readSidecar(texting, secondShape.meta.unframed.result.sidecar)).recipe.of).toEqual({ sidecar: firstSidecar, action: "regenerate" });
  });

  it("deletes its placeholder when the call fails, and reports why", async () => {
    texting.answerText(() => ({ kind: "status", status: 500, body: { error: { message: "model overloaded" } } }));
    const started = await texting.rpc.call("run.text", textRequest());
    const done = await finished(texting.events, started.runId);
    expect(done).toEqual({ type: "finished", runId: started.runId, succeeded: 0, failed: 1, errors: ["OpenRouter (500): model overloaded"], orphaned: 0 });
    expect(eventsOf(texting.events, started.runId)[1]).toEqual({ type: "output", runId: started.runId, runIndex: 1, ok: false, error: "OpenRouter (500): model overloaded" });
    expect((await roomShapes(texting)).some((shape) => shape.id === started.placeholders[0])).toBe(false);
  });

  it("reports a blank answer as a failure", async () => {
    texting.answerText(() => ({ kind: "text", text: "   " }));
    const started = await texting.rpc.call("run.text", textRequest());
    expect((await finished(texting.events, started.runId)).errors).toEqual(["The model returned no text."]);
    expect((await roomShapes(texting)).some((shape) => shape.id === started.placeholders[0])).toBe(false);
  });

  it.each<[string, Partial<TextRunRequest>, string, string]>([
    ["an empty prompt", { prompt: " \n " }, "bad_request", "Prompt is empty. Select a prompt, or type an instruction."],
    ["a missing reference file", { references: [{ kind: "image", file: "nope.png" }] }, "not_found", "Reference file not found in this project: nope.png"],
    ["a link that is not https", { references: [{ kind: "video", url: "ftp://example.com/a.mp4" }] }, "bad_request", "A video link must start with https://."],
  ])("refuses %s and writes nothing", async (_case, overrides, code, message) => {
    const before = await roomShapes(texting);
    const calls = texting.chat.length;
    await expect(texting.rpc.call("run.text", textRequest(overrides))).rejects.toMatchObject({ code, message });
    expect(await roomShapes(texting)).toEqual(before);
    expect(texting.chat).toHaveLength(calls);
  });

  it("does not recreate a placeholder deleted before the answer, and counts it orphaned", async () => {
    const held = gate<void>();
    texting.answerText(async () => {
      await held.promise;
      return { kind: "text", text: "late answer" };
    });
    const started = await texting.rpc.call("run.text", textRequest({ prompt: "late" }));
    await texting.rpc.call("testCanvas.apply", { project: "board", change: { put: [], remove: [started.placeholders[0]!] }, origin: { kind: "server", id: "test" } });
    held.release();
    const done = await finished(texting.events, started.runId);
    expect(done.orphaned).toBe(1);
    expect((await roomShapes(texting)).some((shape) => shape.id === started.placeholders[0])).toBe(false);
    expect((await textSidecars(texting)).some((name) => name.includes("-text-late"))).toBe(true);
  });

  it("fills a placeholder restored after its answer landed, as an undo would", async () => {
    const held = gate<void>();
    texting.answerText(async () => {
      await held.promise;
      return { kind: "text", text: "restored answer", cost: 0.002 };
    });
    const started = await texting.rpc.call("run.text", textRequest({ prompt: "restore me" }));
    const placeholder = (await roomShapes(texting)).find((shape) => shape.id === started.placeholders[0]);
    await texting.rpc.call("testCanvas.apply", { project: "board", change: { put: [], remove: [placeholder.id] }, origin: { kind: "server", id: "test" } });
    held.release();
    await finished(texting.events, started.runId);
    await texting.rpc.call("testCanvas.apply", { project: "board", change: { put: [placeholder], remove: [] }, origin: { kind: "server", id: "test" } });
    let shape: any;
    for (let tries = 0; tries < 100; tries++) {
      shape = (await roomShapes(texting)).find((each) => each.id === placeholder.id);
      if (shape && !shape.meta.unframed.run) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(plainText(shape.props.richText)).toBe("restored answer");
    expect(shape.meta.unframed.result).toMatchObject({ cost: 0.002, sidecar: expect.stringMatching(/-text-restore-me\.json$/) });
  });
});

describe("text sidecar names", () => {
  let texting: Texting;
  beforeAll(async () => {
    texting = await startTexting();
  });
  afterAll(() => texting.engine.dispose());

  /** Starts a run held at the upstream call and answers its file stamp, so a test can take names first. */
  const heldRun = async (prompt: string) => {
    const held = gate<void>();
    texting.answerText(async () => {
      await held.promise;
      return { kind: "text", text: `answer to ${prompt}` };
    });
    const started = await texting.rpc.call("run.text", textRequest({ prompt }));
    const shape = (await roomShapes(texting)).find((each) => each.id === started.placeholders[0]);
    const stamp = new Date(shape.meta.unframed.run.startedAt).toISOString().replace(/[:.]/g, "-");
    return { started, stamp, release: held.release };
  };

  it.each([
    ["the prompt's slug", "A Fox, at Dawn!", "a-fox-at-dawn"],
    ["image when the prompt has no slug", "¡¿!", "image"],
  ])("names the file <stamp>-text-<slug> with %s", async (_case, prompt, slug) => {
    const { started, stamp, release } = await heldRun(prompt);
    release();
    await finished(texting.events, started.runId);
    const shape = (await roomShapes(texting)).find((each) => each.id === started.placeholders[0]);
    expect(shape.meta.unframed.result.sidecar).toBe(`${stamp}-text-${slug}.json`);
    expect(await textSidecars(texting)).toContain(`${stamp}-text-${slug}.json`);
  });

  it("never overwrites: a taken name retries as -2 up to -5", async () => {
    const { started, stamp, release } = await heldRun("taken");
    const base = `${stamp}-text-taken`;
    for (const name of [`${base}.json`, `${base}-2.json`]) await writeFile(join(folderOf(texting), name), "{}\n", { flag: "wx" });
    release();
    await finished(texting.events, started.runId);
    const shape = (await roomShapes(texting)).find((each) => each.id === started.placeholders[0]);
    expect(shape.meta.unframed.result.sidecar).toBe(`${base}-3.json`);
    expect(await readFile(join(folderOf(texting), `${base}.json`), "utf8")).toBe("{}\n");
    expect((await readSidecar(texting, `${base}-3.json`)).result).toBe("answer to taken");
  });

  it("still lands the answer when every name is taken, with no sidecar to point at", async () => {
    const { started, stamp, release } = await heldRun("crowded");
    const base = `${stamp}-text-crowded`;
    for (const name of [`${base}.json`, `${base}-2.json`, `${base}-3.json`, `${base}-4.json`, `${base}-5.json`]) {
      await writeFile(join(folderOf(texting), name), "{}\n", { flag: "wx" });
    }
    release();
    const done = await finished(texting.events, started.runId);
    expect(done).toMatchObject({ succeeded: 1, failed: 0 });
    const shape = (await roomShapes(texting)).find((each) => each.id === started.placeholders[0]);
    expect(plainText(shape.props.richText)).toBe("answer to crowded");
    expect(shape.meta.unframed.result.sidecar).toBeNull();
    expect(shape.meta.unframed.run).toBeUndefined();
  });
});
