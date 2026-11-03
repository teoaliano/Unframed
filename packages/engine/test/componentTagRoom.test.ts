import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine } from "./agent.ts";
import { roomRecords, seed } from "./agentCanvas.ts";
import { componentShape } from "./canvasRecords.ts";

describe("one component shape per tag in the room (spec 20)", () => {
  const start = async () => startAgentEngine({ script: await scriptFolder({ components: { when: "^go", turns: [] } }) });

  it("refuses a second component shape with a tag another shape holds, in one plain sentence, and writes nothing", async () => {
    const agent = await start();
    await seed(agent, [componentShape("tag-first", "uf-tag-held")]);
    await expect(seed(agent, [componentShape("tag-second", "uf-tag-held")])).rejects.toThrow(
      "uf-tag-held is already the component shape:tag-first; write to that shape, or choose another tag",
    );
    const held = (await roomRecords(agent)).filter((record) => record.type === "component" && record.props.tag === "uf-tag-held");
    expect(held.map((record) => record.id)).toEqual(["shape:tag-first"]);
  });

  it("keeps a shape's own tag when the same shape is written again, and accepts a tag no other shape holds", async () => {
    const agent = await start();
    await seed(agent, [componentShape("tag-own", "uf-tag-own", { file: "1-own.html" })]);
    await seed(agent, [componentShape("tag-own", "uf-tag-own", { file: "2-own.html" })]);
    await seed(agent, [componentShape("tag-other", "uf-tag-other")]);
    const ids = (await roomRecords(agent)).filter((record) => record.type === "component").map((record) => record.id);
    expect(ids.sort()).toEqual(["shape:tag-other", "shape:tag-own"]);
  });

  it("refuses two shapes with one tag inside a single change", async () => {
    const agent = await start();
    await expect(seed(agent, [componentShape("pair-a", "uf-tag-pair"), componentShape("pair-b", "uf-tag-pair")])).rejects.toThrow(
      "uf-tag-pair is already the component shape:pair-a; write to that shape, or choose another tag",
    );
  });
});
