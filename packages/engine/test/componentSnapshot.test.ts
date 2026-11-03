import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileComponent, compiledFileName } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { startAgentEngine, type AgentEngine } from "./agent.ts";
import { pageShape } from "./canvasRecords.ts";

const SHEET_FILE = "1761400000000-button.html";
const COMPILED = compiledFileName(SHEET_FILE);
const SHEET = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;
const PAGE = `<!doctype html><html><head><script src="${COMPILED}" data-uf-component="uf-button"></script></head><body><uf-button></uf-button></body></html>`;

const seed = async (agent: AgentEngine, records: unknown[]) =>
  agent.rpc.call("testCanvas.apply", { project: "board", change: { put: records, remove: [] }, origin: { kind: "server", id: "test" } });

const until = async (check: () => boolean, what: string, timeoutMs = 8000): Promise<void> => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe("snapshots and the compiled components they pin", () => {
  it("recreates a pinned compiled file that is missing, with the compiler's bytes, before the capture", async () => {
    const agent = await startAgentEngine({ env: { UNFRAMED_TEST_RENDERER: "ok" } });
    await writeFile(join(agent.folder, SHEET_FILE), SHEET);
    await writeFile(join(agent.folder, "1-landing.html"), PAGE);
    expect(existsSync(join(agent.folder, COMPILED))).toBe(false);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    const snapshots = join(agent.folder, ".cache", "snapshots");
    await until(() => existsSync(join(snapshots, "1-landing.html-480x320-none-none.png")), "the snapshot");
    expect(await readFile(join(agent.folder, COMPILED), "utf8")).toBe(compileComponent(SHEET, SHEET_FILE));
  });

  it("leaves a compiled file that exists alone", async () => {
    const agent = await startAgentEngine({ env: { UNFRAMED_TEST_RENDERER: "ok" } });
    await writeFile(join(agent.folder, SHEET_FILE), SHEET);
    await writeFile(join(agent.folder, COMPILED), "/* kept */");
    await writeFile(join(agent.folder, "1-landing.html"), PAGE);
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    await until(() => existsSync(join(agent.folder, ".cache", "snapshots", "1-landing.html-480x320-none-none.png")), "the snapshot");
    expect(await readFile(join(agent.folder, COMPILED), "utf8")).toBe("/* kept */");
    await rm(join(agent.folder, COMPILED), { force: true });
  });
});
