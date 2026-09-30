import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TextRunRequest } from "@unframed/contracts";
import { describe, expect, it } from "vitest";
import { finished, KEY, pngBytes, runRequest } from "./generation.ts";
import { makeTempDir } from "./harness.ts";
import { gate } from "./openRouterStub.ts";
import { startTexting, type Texting } from "./texting.ts";

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

const refusal = (count: number) => ({
  code: "conflict",
  message: `Wait for the ${count} run${count === 1 ? "" : "s"} still generating in this project to finish, then try again.`,
  details: { liveRuns: count },
});

/** Every lifecycle change refuses while the runs are live, and none of them changed anything. */
const expectRefused = async (texting: Texting, count: number) => {
  const next = join(await makeTempDir(), "renders");
  await expect(texting.rpc.call("projects.rename", { name: "board", to: "renamed" })).rejects.toMatchObject(refusal(count));
  await expect(texting.rpc.call("projects.delete", { name: "board", confirmRenders: true })).rejects.toMatchObject(refusal(count));
  await expect(texting.rpc.call("settings.update", { outputDir: next })).rejects.toMatchObject(refusal(count));
  expect((await texting.rpc.call("projects.list")).projects).toEqual(["board"]);
  expect(existsSync(join(texting.engine.dataDir, "output", "board"))).toBe(true);
  expect(existsSync(next)).toBe(false);
  expect(await readFile(join(texting.engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${KEY}\n`);
};

describe("lifecycle changes while runs are still generating", () => {
  it("refuse a rename, a delete and a folder change while image and text runs are live, and go through once they finish", async () => {
    const texting = await startTexting();
    const image = gate<void>();
    const text = gate<void>();
    texting.answer(async () => {
      await image.promise;
      return { kind: "image", bytes: pngBytes(8, 8) };
    });
    texting.answerText(async () => {
      await text.promise;
      return { kind: "text", text: "done" };
    });

    const imageRun = await texting.rpc.call("run.image", runRequest({ outputs: [{ prompt: "one", references: [] }, { prompt: "two", references: [] }] }));
    const textRun = await texting.rpc.call("run.text", textRequest());
    await expectRefused(texting, 2);

    image.release();
    await finished(texting.events, imageRun.runId);
    await expectRefused(texting, 1);

    text.release();
    await finished(texting.events, textRun.runId);
    expect(await texting.rpc.call("projects.rename", { name: "board", to: "renamed" })).toEqual({ name: "renamed", movedRenders: 0 });
  });

  it("does not count a run in another project", async () => {
    const texting = await startTexting();
    await texting.rpc.call("projects.create", { name: "other" });
    const held = gate<void>();
    texting.answerText(async () => {
      await held.promise;
      return { kind: "text", text: "done" };
    });
    await texting.rpc.call("run.text", textRequest({ project: "other" }));
    expect(await texting.rpc.call("projects.rename", { name: "board", to: "renamed" })).toEqual({ name: "renamed", movedRenders: 0 });
    // A folder change touches every project, so a live run anywhere refuses it.
    await expect(texting.rpc.call("settings.update", { outputDir: join(await makeTempDir(), "renders") })).rejects.toMatchObject(refusal(1));
    held.release();
  });
});
