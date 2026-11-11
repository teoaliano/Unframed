import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toCss, toDtcg, toTailwind, type Kit } from "@unframed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pageShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";

const DOCUMENT = "document:document";
const kit: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
};
const documentWith = (value: Kit | null) => ({ id: DOCUMENT, typeName: "document", gridSize: 10, name: "", meta: value === null ? {} : { unframed: { kit: value } } });

describe("kit usage and export (spec 19, tasks 17 and 35)", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  const folder = () => join(engine.dataDir, "output", "board");

  it("answers the artifacts that use each token and each mode, from the files they show now", async () => {
    const rpc = await engine.rpc();
    await writeFile(join(folder(), "1-page.html"), `<style>h1{color:var(--color-brand-primary)}</style>`);
    await writeFile(join(folder(), "2-motion.html"), `<script>unframed.token("color/brand/primary")</script>`);
    await writeFile(join(folder(), "3-plain.html"), `<p>no token</p>`);
    await rpc.call("testCanvas.apply", {
      project: "board",
      change: {
        put: [
          documentWith(kit),
          pageShape("usepage", "301", { file: "1-page.html", title: "p", fileName: "p.html", mode: "dark" }),
          { ...pageShape("usemotion", "302", { file: "2-motion.html", title: "m", fileName: "m.html" }), type: "motion" },
          pageShape("plain", "303", { file: "3-plain.html", title: "x", fileName: "x.html" }),
        ],
        remove: [],
      },
      origin: { kind: "server", id: "kit:u1" },
    });
    expect(await rpc.call("kit.usage", { project: "board" })).toEqual({
      tokens: { "color/brand/primary": ["shape:usepage", "shape:usemotion"] },
      modes: { light: ["shape:usemotion", "shape:plain"], dark: ["shape:usepage"] },
    });
  });

  it("writes the kit as CSS into the project folder with its export sidecar", async () => {
    const rpc = await engine.rpc();
    const { file } = await rpc.call("kit.exportFile", { project: "board", format: "css" });
    expect(file).toMatch(/^\d+-kit-brand\.css$/);
    expect(await readFile(join(folder(), file), "utf8")).toBe(toCss(kit));
    const sidecar = JSON.parse(await readFile(join(folder(), file.replace(/\.css$/, ".json")), "utf8"));
    expect(sidecar).toEqual({ source: "export", kind: "kit", format: "css", kit: "Brand", stamp: expect.stringMatching(/^[0-9a-f]{8}$/), at: expect.any(String) });
  });

  it("writes the DTCG and Tailwind exports under exclusive names, each with its own sidecar", async () => {
    const rpc = await engine.rpc();
    const dtcg = await rpc.call("kit.exportFile", { project: "board", format: "dtcg" });
    const tailwind = await rpc.call("kit.exportFile", { project: "board", format: "tailwind" });
    expect(dtcg.file).toMatch(/^\d+-kit-brand\.tokens\.json$/);
    expect(tailwind.file).toMatch(/^\d+-kit-brand\.tailwind\.css$/);
    expect(await readFile(join(folder(), dtcg.file), "utf8")).toBe(toDtcg(kit));
    expect(await readFile(join(folder(), tailwind.file), "utf8")).toBe(toTailwind(kit));
    const names = await readdir(folder());
    expect(names.filter((name) => name.endsWith(".json") && name.includes("-kit-")).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses an export when the project has no kit, and writes nothing", async () => {
    const rpc = await engine.rpc();
    await rpc.call("testCanvas.apply", { project: "board", change: { put: [documentWith(null)], remove: [] }, origin: { kind: "server", id: "kit:u2" } });
    const before = (await readdir(folder())).length;
    await expect(rpc.call("kit.exportFile", { project: "board", format: "css" })).rejects.toMatchObject({ message: "This project has no kit yet." });
    expect((await readdir(folder())).length).toBe(before);
  });
});
