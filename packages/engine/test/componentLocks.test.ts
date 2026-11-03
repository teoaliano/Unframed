import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { roomShape, seed, toolResults } from "./agentCanvas.ts";
import { componentShape } from "./canvasRecords.ts";

/** Spec 20, task 12: `component_write` runs spec 18's lock check against the shape's current sheet. */

const LOCKED = `<!doctype html><html><head>
<script src="unframed-dials.js"></script>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label" data-hf-id="hf-bbbb">Buy</button></div></body></html>`;

const script = (tools: Array<{ name: string; input: Record<string, unknown> }>) =>
  scriptFolder({ components: { when: "^go", turns: [{ text: "Done.", tools }] } });

const sheets = async (agent: AgentEngine) => (await readdir(agent.folder)).filter((name) => name.endsWith(".html")).sort();

describe("component_write and locks (spec 20, task 12)", () => {
  it("refuses a write that changes a locked template element, writing nothing, and accepts one that changes only unlocked parts", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { name: "component_write", input: { shapeId: "c1", html: LOCKED.replace("Buy", "Buy now") } },
        { name: "component_write", input: { shapeId: "c1", html: LOCKED.replace(":host { display: inline-block; }", ":host { display: block; }") } },
      ]),
    });
    await writeFile(join(agent.folder, "1-button.html"), LOCKED);
    await seed(agent, [componentShape("c1", "uf-button", { file: "1-button.html", title: "Button", lockedElements: ["hf-bbbb"] })]);
    const before = await sheets(agent);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go", {});
    const chat = await agent.settled(chatId, 1);

    const [refused, accepted] = toolResults(chat, "component_write");
    expect(refused).toMatchObject({ status: "failed" });
    expect(String((refused?.result as { error?: string }).error)).toMatch(
      /^The element data-hf-id="hf-bbbb" \(".*"\) is locked by the person, and this write changes it\. Keep that element exactly as it is in the current file \(component_read shows it\)/,
    );
    expect(accepted).toMatchObject({ status: "completed", result: { ok: true, shapeId: "c1" } });
    const shape = await roomShape(agent, "c1");
    expect(shape.props.file).not.toBe("1-button.html");
    expect(await sheets(agent)).toEqual([...before, shape.props.file as string].sort());
  });
});
