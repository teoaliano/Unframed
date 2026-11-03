import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startAgentEngine, type AgentEngine } from "./agent.ts";
import { motionShape, seed } from "./agentCanvas.ts";
import { componentShape, pageShape } from "./canvasRecords.ts";

const LANDING = `<!doctype html><html><head><script src="1-button.component.js" data-uf-component="uf-button"></script><script src="2-card.component.js" data-uf-component="uf-card"></script></head><body></body></html>`;
const INTRO = `<!doctype html><html><head><script src="1-button.component.js" data-uf-component="uf-button"></script></head><body></body></html>`;
const PLAIN = `<!doctype html><html><body><h1>No components</h1></body></html>`;

const commit = async (agent: AgentEngine, records: unknown[]) =>
  agent.rpc.call("testCanvas.apply", { project: "board", change: { put: records, remove: [] }, origin: { kind: "server", id: "test-commit" } });

const until = async (check: () => boolean, what: string) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 10_000) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
};

const startProject = async (): Promise<AgentEngine> => {
  const agent = await startAgentEngine();
  await writeFile(join(agent.folder, "1-landing.html"), LANDING);
  await writeFile(join(agent.folder, "2-intro.html"), INTRO);
  await writeFile(join(agent.folder, "3-plain.html"), PLAIN);
  await writeFile(join(agent.folder, "4-later.html"), PLAIN);
  return agent;
};

describe("component.pins", () => {
  it("streams every page and motion file's pins, then one item for each newly named file", async () => {
    const agent = await startProject();
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" }), motionShape("m1", "101", "Intro", { file: "2-intro.html" }, { y: 400 })]);
    const stream = agent.rpc.subscribe("component.pins", { project: "board" });
    await until(() => stream.values.length === 2, "the two files' pins");
    expect(stream.values).toEqual([
      {
        file: "1-landing.html",
        pins: [
          { tag: "uf-button", sheet: "1-button.html" },
          { tag: "uf-card", sheet: "2-card.html" },
        ],
      },
      { file: "2-intro.html", pins: [{ tag: "uf-button", sheet: "1-button.html" }] },
    ]);

    await commit(agent, [pageShape("pg2", "102", { file: "3-plain.html", title: "Plain" }, { y: 800 })]);
    await until(() => stream.values.length === 3, "the new file's pins");
    expect(stream.values[2]).toEqual({ file: "3-plain.html", pins: [] });

    await commit(agent, [pageShape("pg3", "103", { file: "1-landing.html", title: "Again" }, { y: 1200 })]);
    await commit(agent, [pageShape("pg4", "104", { file: "4-later.html", title: "Later" }, { y: 1600 })]);
    await until(() => stream.values.length === 4, "the later file's pins");
    expect(stream.values.map((item: any) => item.file)).toEqual(["1-landing.html", "2-intro.html", "3-plain.html", "4-later.html"]);
  });

  it("answers a new subscriber with every file's pins from the start", async () => {
    const agent = await startProject();
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    const first = agent.rpc.subscribe("component.pins", { project: "board" });
    await until(() => first.values.length === 1, "the first subscriber");
    const later = agent.rpc.subscribe("component.pins", { project: "board" });
    await until(() => later.values.length === 1, "the later subscriber");
    expect(later.values[0]).toEqual(first.values[0]);
  });

  it("does not list a shape that names no file, or a component shape, which is not an artifact", async () => {
    const agent = await startProject();
    await seed(agent, [pageShape("pg1", "100", { file: "", title: "Empty" }), componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" }, { y: 400 })]);
    const stream = agent.rpc.subscribe("component.pins", { project: "board" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stream.values).toEqual([]);
  });

  it("answers not_found for a project that does not exist", async () => {
    const agent = await startProject();
    const stream = agent.rpc.subscribe("component.pins", { project: "nowhere" });
    await expect(stream.next(0)).rejects.toMatchObject({ code: "not_found" });
  });
});
