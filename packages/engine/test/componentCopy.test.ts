import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileComponent, compiledFileName } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { startAgentEngine, type AgentEngine } from "./agent.ts";
import { seed } from "./agentCanvas.ts";
import { componentShape } from "./canvasRecords.ts";

const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const setup = async (): Promise<AgentEngine> => {
  const agent = await startAgentEngine();
  await writeFile(join(agent.folder, "1-button.html"), BUTTON);
  await seed(agent, [componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" })]);
  await agent.rpc.call("projects.create", { name: "two" });
  return agent;
};

const folderOf = (agent: AgentEngine, project: string) => join(agent.engine.dataDir, "output", project);

const copy = (agent: AgentEngine, input: { project: string; file: string; from?: string }) => agent.rpc.call("component.copy", input);

describe("component.copy", () => {
  it("writes a copy with a fresh tag within the project, and its compiled file and copy sidecar", async () => {
    const agent = await setup();
    const { file, tag } = await copy(agent, { project: "board", file: "1-button.html" });
    expect(tag).toBe("uf-button-copy");
    expect(file).toMatch(/^\d+-button\.html$/);
    const html = await readFile(join(agent.folder, file), "utf8");
    expect(html).toBe(BUTTON.replace('"tag":"uf-button"', '"tag":"uf-button-copy"'));
    expect(await readFile(join(agent.folder, compiledFileName(file)), "utf8")).toBe(compileComponent(html, file));
    expect(JSON.parse(await readFile(join(agent.folder, file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({
      source: "copy",
      fileName: "button.html",
      mime: "text/html",
      of: "1-button.html",
      tag: "uf-button-copy",
      compiled: compiledFileName(file),
    });
  });

  it("takes the next free tag while the canvas holds the earlier copy", async () => {
    const agent = await setup();
    await seed(agent, [componentShape("c2", "uf-button-copy", { file: "", title: "Copy" }, { y: 400 })]);
    expect((await copy(agent, { project: "board", file: "1-button.html" })).tag).toBe("uf-button-copy-2");
  });

  it("keeps the tag across projects when the destination does not hold it, and renames it when it does", async () => {
    const agent = await setup();
    const kept = await agent.rpc.call("component.copy", { project: "two", file: "1-button.html", from: "board" });
    expect(kept.tag).toBe("uf-button");
    expect(await readFile(join(folderOf(agent, "two"), kept.file), "utf8")).toBe(BUTTON);
    expect(existsSync(join(folderOf(agent, "two"), compiledFileName(kept.file)))).toBe(true);

    await agent.rpc.call("testCanvas.apply", {
      project: "two",
      change: { put: [componentShape("d1", "uf-button", { file: kept.file, title: "Button" })], remove: [] },
      origin: { kind: "system", id: "test-seed" },
    });
    const renamed = await agent.rpc.call("component.copy", { project: "two", file: "1-button.html", from: "board" });
    expect(renamed.tag).toBe("uf-button-copy");
  });

  it("answers not_found for a missing file, and bad_request for a file that is not a sheet", async () => {
    const agent = await setup();
    await writeFile(join(agent.folder, "2-plain.html"), "<h1>not a component</h1>");
    await expect(copy(agent, { project: "board", file: "9-gone.html" })).rejects.toMatchObject({ code: "not_found" });
    await expect(copy(agent, { project: "board", file: "2-plain.html" })).rejects.toMatchObject({
      code: "bad_request",
      message: "a component sheet needs one <script type=\"application/json\" data-uf-component> declaration",
    });
  });
});
