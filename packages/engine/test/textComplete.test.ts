import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KEY, pngBytes } from "./generation.ts";
import { startEngine } from "./harness.ts";
import { readSidecar, roomShapes, startTexting, textSidecars, upload, type Texting } from "./texting.ts";

const DEFAULT_TEXT_MODEL = "google/gemini-3.5-flash-lite";

describe("text.complete", () => {
  let texting: Texting;
  beforeAll(async () => {
    texting = await startTexting();
  });
  afterAll(() => texting.engine.dispose());

  it("sends one user message of text and inlined references, answers the text and cost, and leaves a sidecar with no recipe", async () => {
    const photo = await upload(texting, "photo.png", pngBytes(4, 4), "image/png");
    const clip = await upload(texting, "clip.mp4", Buffer.from("fake mp4"), "video/mp4");
    const before = await roomShapes(texting);
    texting.answerText(() => ({ kind: "text", text: "  a fox\n---\na wolf  ", cost: 0.0012 }));

    const answer = await texting.rpc.call("text.complete", {
      project: "board",
      prompt: "Describe these pictures",
      references: [
        { kind: "image", file: photo },
        { kind: "video", file: clip },
        { kind: "video", url: "https://example.com/linked.mp4" },
      ],
    });
    expect(answer).toEqual({ text: "  a fox\n---\na wolf  ", cost: 0.0012 });

    const [call] = texting.chat;
    expect(call!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call!.body).toEqual({
      model: DEFAULT_TEXT_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe these pictures" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${pngBytes(4, 4).toString("base64")}` } },
            { type: "video_url", video_url: { url: `data:video/mp4;base64,${Buffer.from("fake mp4").toString("base64")}` } },
            { type: "video_url", video_url: { url: "https://example.com/linked.mp4" } },
          ],
        },
      ],
      usage: { include: true },
    });

    const [name] = await textSidecars(texting);
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-text-describe-these-pictures\.json$/);
    const sidecar = await readSidecar(texting, name!);
    expect(sidecar).toEqual({
      kind: "text",
      prompt: "Describe these pictures",
      model: DEFAULT_TEXT_MODEL,
      result: "  a fox\n---\na wolf  ",
      referenceCount: 3,
      references: { images: 1, videos: 2 },
      batchId: null,
      cost: 0.0012,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    // It lands nothing.
    expect(await roomShapes(texting)).toEqual(before);
  });

  it("uses the given model, records the batch id, and answers a missing cost as null", async () => {
    texting.answerText(() => ({ kind: "text", text: "a hare", cost: null }));
    const before = (await textSidecars(texting)).length;
    const answer = await texting.rpc.call("text.complete", { project: "board", prompt: "one hare", model: "openai/gpt-5", batchId: "b-42" });
    expect(answer).toEqual({ text: "a hare", cost: null });
    expect(texting.chat.at(-1)!.body).toEqual({ model: "openai/gpt-5", messages: [{ role: "user", content: [{ type: "text", text: "one hare" }] }], usage: { include: true } });
    const names = await textSidecars(texting);
    expect(names).toHaveLength(before + 1);
    const sidecar = await readSidecar(texting, names.find((name) => name.endsWith("-text-one-hare.json"))!);
    expect(sidecar).toMatchObject({ batchId: "b-42", cost: null, model: "openai/gpt-5", referenceCount: 0, references: { images: 0, videos: 0 } });
    expect(sidecar.recipe).toBeUndefined();
  });

  it("sends a system message first when one is given", async () => {
    texting.answerText(() => ({ kind: "text", text: "a fox\n---\na wolf" }));
    await texting.rpc.call("text.complete", { project: "board", prompt: "Text to rewrite:\n\ntwo animals", system: "You rewrite a rough description." });
    expect(texting.chat.at(-1)!.body.messages).toEqual([
      { role: "system", content: "You rewrite a rough description." },
      { role: "user", content: [{ type: "text", text: "Text to rewrite:\n\ntwo animals" }] },
    ]);
  });

  it.each([
    ["empty", ""],
    ["blank", "  \n "],
  ])("ignores a system message that is %s", async (_case, system) => {
    await texting.rpc.call("text.complete", { project: "board", prompt: "a fox", system });
    expect(texting.chat.at(-1)!.body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "a fox" }] }]);
  });
});

describe("text.complete failures", () => {
  let texting: Texting;
  beforeAll(async () => {
    texting = await startTexting();
  });
  afterAll(() => texting.engine.dispose());

  it.each<[string, Record<string, unknown>, string, string]>([
    ["an empty prompt", { prompt: "  \n " }, "bad_request", "Prompt is empty. Select a prompt, or type an instruction."],
    ["a reference file not in the project", { prompt: "a fox", references: [{ kind: "image", file: "../elsewhere/gone.png" }] }, "not_found", "Reference file not found in this project: gone.png"],
    ["a video link that is not https", { prompt: "a fox", references: [{ kind: "video", url: "http://example.com/a.mp4" }] }, "bad_request", "A video link must start with https://."],
  ])("refuses %s, calling nothing and writing nothing", async (_case, request, code, message) => {
    const calls = texting.chat.length;
    await expect(texting.rpc.call("text.complete", { project: "board", ...request } as never)).rejects.toMatchObject({ code, message });
    expect(texting.chat).toHaveLength(calls);
    expect(await textSidecars(texting)).toEqual([]);
  });

  it.each([
    ["an error status", { kind: "status", status: 500, body: { error: { message: "model overloaded" } } }, "OpenRouter (500): model overloaded"],
    [
      "unpaid",
      { kind: "status", status: 402, body: { error: { message: "Insufficient credits" } } },
      "OpenRouter refused this as unpaid: either the account is out of credit, or this key has hit its own spending cap. Add credit at openrouter.ai/credits, or check the key's cap at openrouter.ai/settings/keys. (Insufficient credits)",
    ],
    ["a body that is not JSON", { kind: "not-json", text: `<html>${"x".repeat(400)}</html>` }, `Unexpected response from OpenRouter: <html>${"x".repeat(294)}`],
    ["no choices", { kind: "no-choices" }, "The model returned no text."],
    ["a blank answer", { kind: "text", text: " \n\t " }, "The model returned no text."],
    ["an answer that is not text", { kind: "text", text: null }, "The model returned no text."],
  ] as const)("fails with %s and writes no sidecar", async (_case, answer, message) => {
    texting.answerText(() => answer as never);
    await expect(texting.rpc.call("text.complete", { project: "board", prompt: "a fox" })).rejects.toMatchObject({ message });
    expect(await textSidecars(texting)).toEqual([]);
  });

  it("fails with the charged warning when the body is lost mid-read", async () => {
    texting.answerText(() => ({ kind: "drop" }));
    await expect(texting.rpc.call("text.complete", { project: "board", prompt: "a fox" })).rejects.toMatchObject({
      message: expect.stringMatching(
        /^Lost the connection while reading OpenRouter's answer: .+\. The run may still have completed and been charged\. Check your OpenRouter activity page\.$/,
      ),
    });
  });

  it("fails when OpenRouter cannot be reached", async () => {
    const engine = await startEngine({ dotenv: `OPENROUTER_API_KEY=${KEY}\n`, env: { UNFRAMED_TEST_OPENROUTER_ORIGIN: "http://127.0.0.1:9" } });
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    await expect(rpc.call("text.complete", { project: "board", prompt: "a fox" })).rejects.toMatchObject({ message: expect.stringMatching(/^Could not reach OpenRouter: .+/) });
  });

  it("refuses without a key before anything else", async () => {
    const engine = await startEngine({});
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    await expect(rpc.call("text.complete", { project: "board", prompt: "" })).rejects.toMatchObject({
      code: "unavailable",
      message: "No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).",
    });
    expect(engine.stub!.requests).toEqual([]);
  });
});
