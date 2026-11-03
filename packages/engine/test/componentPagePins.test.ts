import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG, compileComponent, compiledFileName, TOKENS_TAG } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { roomShape, seed, toolResults } from "./agentCanvas.ts";
import { componentShape, pageShape } from "./canvasRecords.ts";

/** Spec 20, task 15: `page_write` and `motion_write` inject pins for the canvas's components and return `components`. */

const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const script = (tools: Array<{ name: string; input: Record<string, unknown> }>) =>
  scriptFolder({ pins: { when: "^go", turns: [{ text: "Done.", tools }] } });

/** The sheets of a project: a current button and an older one, each with its compiled file. */
const writeSheets = async (agent: AgentEngine) => {
  for (const sheet of ["1-button.html", "2-button.html"]) {
    await writeFile(join(agent.folder, sheet), BUTTON);
    await writeFile(join(agent.folder, compiledFileName(sheet)), compileComponent(BUTTON, sheet));
  }
};

const run = async (agent: AgentEngine, kind: "page_write" | "motion_write" | "both", html: string) => {
  const names = kind === "both" ? ["page_write", "motion_write"] : [kind];
  const chatId = await agent.createChat();
  await agent.send(chatId, "go", {});
  return { chatId, chat: await agent.settled(chatId, 1), names };
};

describe("page_write and motion_write pins (spec 20)", () => {
  it("adds a pin for a used component right after the tokens tag, before the bridge, and returns components", async () => {
    const agent = await startAgentEngine({
      script: await script([{ name: "page_write", input: { shapeId: "pg1", html: `<!doctype html><html><head></head><body><uf-button label="Buy now"></uf-button><uf-tile></uf-tile></body></html>` } }]),
    });
    await writeSheets(agent);
    await seed(agent, [componentShape("c1", "uf-button", { file: "2-button.html", title: "Button" }), pageShape("pg1", "100")]);
    const { chat } = await run(agent, "page_write", "");
    const [write] = toolResults(chat, "page_write");
    expect(write?.status).toBe("completed");
    const file = (await roomShape(agent, "pg1")).props.file as string;
    const html = await readFile(join(agent.folder, file), "utf8");
    const pin = '<script src="2-button.component.js" data-uf-component="uf-button"></script>';
    expect(html.indexOf(TOKENS_TAG)).toBeLessThan(html.indexOf(pin));
    expect(html.indexOf(pin)).toBeLessThan(html.indexOf(BRIDGE_TAG));
    expect(html.match(/data-uf-component="uf-button"/g)).toHaveLength(1);
    expect(write?.result).toMatchObject({ ok: true, components: { pinned: ["uf-button"], olderVersions: [], unknownTags: ["uf-tile"] } });
  });

  it("keeps an older valid pin on a rewrite and reports it in olderVersions", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { name: "page_write", input: { shapeId: "pg1", html: `<!doctype html><html><head><script src="1-button.component.js" data-uf-component="uf-button"></script></head><body><uf-button>Old</uf-button></body></html>` } },
        { name: "page_write", input: { shapeId: "pg1", html: `<!doctype html><html><head></head><body><p>Plain</p></body></html>` } },
      ]),
    });
    await writeSheets(agent);
    await seed(agent, [componentShape("c1", "uf-button", { file: "2-button.html", title: "Button" }), pageShape("pg1", "100", { file: "", title: "Page" })]);
    const { chat } = await run(agent, "page_write", "");
    const [first, second] = toolResults(chat, "page_write");
    expect(first?.result).toMatchObject({ components: { pinned: ["uf-button"], olderVersions: ["uf-button"], unknownTags: [] } });
    expect(second?.result).not.toHaveProperty("components");
  });
});
