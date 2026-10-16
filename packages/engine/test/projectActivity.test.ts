import { describe, expect, it } from "vitest";
import { finished, pngBytes, runRequest } from "./generation.ts";
import { gate } from "./openRouterStub.ts";
import { startTexting } from "./texting.ts";

describe("projects.activity", () => {
  it("sends nothing while every project is quiet, then the live run's project, then zeros when it lands", async () => {
    const texting = await startTexting();
    await texting.rpc.call("projects.create", { name: "quiet" });
    const image = gate<void>();
    texting.answer(async () => {
      await image.promise;
      return { kind: "image", bytes: pngBytes(8, 8) };
    });

    const watch = texting.rpc.subscribe("projects.activity");
    const run = await texting.rpc.call("run.image", runRequest({ project: "board", outputs: [{ prompt: "one", references: [] }] }));
    expect(await watch.next()).toEqual({ project: "board", running: 1, needsYou: 0 });

    image.release();
    await finished(texting.events, run.runId);
    expect(await watch.next()).toEqual({ project: "board", running: 0, needsYou: 0 });
    expect(watch.values.map((item: { project: string }) => item.project)).not.toContain("quiet");
  });
});
