import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { plainText } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { connectTab } from "./syncClient.ts";
import { byRef, canvasRecords, startLegacyEngine } from "./legacy.ts";

const DATABASE = "unframed.sqlite";

describe("the import trigger", () => {
  it("imports a folder with an old graph and no database on its first open, whatever opens it", async () => {
    const { engine, folder } = await startLegacyEngine();
    for (const project of ["everything", "legacy-snapshot", "broken-snapshot"]) expect(existsSync(join(folder(project), DATABASE))).toBe(false);

    // A tab's sync socket.
    const tab = await connectTab(engine.port, "everything");
    await tab.loaded;
    const fromTab = tab.records() as unknown as Array<{ typeName: string; type?: string; meta?: any; props?: any }>;
    expect(plainText((byRef(fromTab as never, "101") as { props: { richText: unknown } }).props.richText)).toBe("lone red fox");
    expect(existsSync(join(folder("everything"), DATABASE))).toBe(true);
    await tab.close();

    // An engine-side read of the room.
    const snapshotRecords = await canvasRecords(engine, "legacy-snapshot");
    expect(plainText(byRef(snapshotRecords, "100")!.props.richText)).toBe("A fox running along the beach at low tide");

    // The chat store, which opens the project database without the room.
    const rpc = await engine.rpc();
    const shell = rpc.subscribe("orchestration.subscribeShell", { projectId: "broken-snapshot" });
    await shell.next(0);
    expect(existsSync(join(folder("broken-snapshot"), DATABASE))).toBe(true);
    expect(byRef(await canvasRecords(engine, "broken-snapshot"), "102")).toMatchObject({ type: "frame" });
  });

  it("imports a folder that holds only graph.log", async () => {
    const { engine, folder } = await startLegacyEngine();
    await mkdir(folder("journal-only"));
    await writeFile(
      join(folder("journal-only"), "graph.log"),
      `${JSON.stringify({ version: 1, op: { type: "addNode", node: { id: "100", type: "prompt", position: { x: 0, y: 0 }, data: { text: "a fox" } } }, inverse: null, origin: { kind: "session" }, at: 1 })}\n`,
    );
    const records = await canvasRecords(engine, "journal-only");
    expect(plainText(byRef(records, "100")!.props.richText)).toBe("a fox");
    expect(records.filter((record) => record.typeName === "shape")).toHaveLength(1);
  });

  it("seeds starter content, and imports nothing, in a folder without an old graph", async () => {
    const { engine, folder } = await startLegacyEngine();
    await mkdir(folder("fresh"));
    const shapes = (await canvasRecords(engine, "fresh")).filter((record) => record.typeName === "shape");
    expect(shapes.map((shape) => plainText(shape.props.richText))).toContain("lone red fox");
    expect(await (await engine.rpc()).call("legacyImport.report", { project: "fresh" })).toBeNull();
  });
});
