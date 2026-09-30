import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { plainText } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { byRef, canvasRecords, fileDigests, legacyDataDir, SAMPLE_PROJECTS, SAMPLES, startLegacyEngine } from "./legacy.ts";

const DATABASE = "unframed.sqlite";
const until = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000) => {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const leftovers = async (folder: string) => (await readdir(folder)).filter((name) => name.startsWith(`${DATABASE}.import-`));

describe("the atomic write", () => {
  it("leaves no database behind a crash mid-import, removes the leftover temporary files, and imports cleanly next time", async () => {
    const dataDir = await legacyDataDir();
    const folder = join(dataDir, "output", "everything");
    // The journal is a pipe: the import blocks reading it until the test writes it.
    await rm(join(folder, "graph.log"));
    execFileSync("mkfifo", [join(folder, "graph.log")]);
    await writeFile(join(folder, `${DATABASE}.import-99999.tmp`), "a torn database");
    await writeFile(join(folder, `${DATABASE}.import-99999.tmp-journal`), "its journal");

    const first = await startEngine({ dataDir, env: { UNFRAMED_TEST_CANVAS: "1" } });
    const rpc = await first.rpc();
    const opening = rpc.call("testCanvas.read", { project: "everything" });
    opening.catch(() => {});
    await until(async () => (await leftovers(folder)).length === 0, "the leftovers to go");
    expect(existsSync(join(folder, DATABASE))).toBe(false);
    expect(await rpc.call("legacyImport.status", { project: "everything" })).toEqual({ state: "pending" });
    await first.stop("SIGKILL");
    expect(existsSync(join(folder, DATABASE))).toBe(false);

    await writeFile(join(folder, `${DATABASE}.import-4242.tmp`), "another torn one");
    await rm(join(folder, "graph.log"));
    await copyFile(join(SAMPLES, "everything", "graph.log"), join(folder, "graph.log"));
    const second = await startEngine({ dataDir, env: { UNFRAMED_TEST_CANVAS: "1" } });
    const records = await canvasRecords(second, "everything");
    expect(plainText(byRef(records, "101")!.props.richText)).toBe("lone red fox");
    expect(await leftovers(folder)).toEqual([]);
    const report = await (await second.rpc()).call("legacyImport.report", { project: "everything" });
    expect(report).toMatchObject({ source: { snapshotVersion: 4, journalEntriesApplied: 6, journalStoppedAtLine: 13 }, seen: false });
  });

  it("builds the whole database, canvas and report, before it is in place", async () => {
    const { engine, folder } = await startLegacyEngine();
    await canvasRecords(engine, "legacy-snapshot");
    await engine.stop();
    const db = new DatabaseSync(join(folder("legacy-snapshot"), DATABASE), { readOnly: true });
    try {
      const migrations = db.prepare("SELECT id FROM unframed_migrations ORDER BY id").all().map((row) => Number(row.id));
      expect(migrations).toEqual([1, 2, 3, 4]);
      expect(Number(db.prepare("SELECT count(*) AS n FROM legacy_import_report").get()!.n)).toBe(1);
      const log = db.prepare("SELECT origin_kind, origin_id, put FROM canvas_changes ORDER BY clock").all();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ origin_kind: "system", origin_id: "legacy-import" });
      expect((JSON.parse(String(log[0]!.put)) as string[]).length).toBeGreaterThan(4);
    } finally {
      db.close();
    }
  });
});

describe("never rewriting the old files", () => {
  it("leaves every old file byte-identical, and adds only the database and what it extracted", async () => {
    const { engine, outputDir } = await startLegacyEngine();
    const before = await fileDigests(outputDir);
    for (const project of SAMPLE_PROJECTS) await canvasRecords(engine, project);
    await engine.stop();
    const after = await fileDigests(outputDir);
    for (const [path, digest] of Object.entries(before)) expect(after[path], path).toBe(digest);
    const added = Object.keys(after)
      .filter((path) => !(path in before))
      .sort();
    expect(added).toEqual(
      [
        "broken-snapshot/unframed.sqlite",
        "everything/legacy-5c59251f1b05f008-sketch.json",
        "everything/legacy-5c59251f1b05f008-sketch.png",
        "everything/unframed.sqlite",
        "legacy-snapshot/legacy-af3411e27cb1bd79-beach.json",
        "legacy-snapshot/legacy-af3411e27cb1bd79-beach.png",
        "legacy-snapshot/legacy-cf4b71560e735285-upload.json",
        "legacy-snapshot/legacy-cf4b71560e735285-upload.png",
        "legacy-snapshot/unframed.sqlite",
      ].sort(),
    );
    expect(existsSync(join(outputDir, "everything", "graph.log.stale-1789031400000"))).toBe(true);
  });
});

describe("extracted files", () => {
  it("get deterministic legacy- names and legacy-graph sidecars, and a rerun reuses them", async () => {
    const dataDir = await legacyDataDir();
    const first = await startLegacyEngine({ dataDir });
    const records = await canvasRecords(first.engine, "legacy-snapshot");
    await first.engine.stop();
    const folder = first.folder("legacy-snapshot");
    const beach = join(folder, "legacy-af3411e27cb1bd79-beach.png");
    const sidecar = JSON.parse(await readFile(join(folder, "legacy-af3411e27cb1bd79-beach.json"), "utf8"));
    expect(sidecar).toEqual({ source: "legacy-graph", fileName: "beach.png", mime: "image/png", bytes: (await readFile(beach)).length, at: expect.any(String) });
    expect(JSON.parse(await readFile(join(folder, "legacy-cf4b71560e735285-upload.json"), "utf8"))).toMatchObject({ source: "legacy-graph", fileName: "", mime: "image/png" });
    const asset = records.find((record) => record.typeName === "asset" && record.props.src === "project-file:legacy-af3411e27cb1bd79-beach.png");
    expect(asset).toMatchObject({ props: { name: "beach.png", w: 64, h: 40 } });

    // A crash after the files and before the rename: the next import finds them in place.
    const stamps = await fileDigests(folder);
    const { mtimeMs } = await stat(beach);
    await rm(join(folder, DATABASE));
    // A torn extraction of the other file is written again.
    await writeFile(join(folder, "legacy-cf4b71560e735285-upload.png"), "torn");
    const second = await startEngine({ dataDir, env: { UNFRAMED_TEST_CANVAS: "1" } });
    await canvasRecords(second, "legacy-snapshot");
    await second.stop();
    const after = await fileDigests(folder);
    expect(after["legacy-af3411e27cb1bd79-beach.png"]).toBe(stamps["legacy-af3411e27cb1bd79-beach.png"]);
    expect(after["legacy-af3411e27cb1bd79-beach.json"]).toBe(stamps["legacy-af3411e27cb1bd79-beach.json"]);
    expect(after["legacy-cf4b71560e735285-upload.png"]).toBe(stamps["legacy-cf4b71560e735285-upload.png"]);
    expect((await stat(beach)).mtimeMs).toBe(mtimeMs);
    expect(Object.keys(after).filter((name) => name.startsWith("legacy-")).sort()).toEqual([
      "legacy-af3411e27cb1bd79-beach.json",
      "legacy-af3411e27cb1bd79-beach.png",
      "legacy-cf4b71560e735285-upload.json",
      "legacy-cf4b71560e735285-upload.png",
    ]);
  });
});

describe("importing once", () => {
  it("never imports again, whether the folder is opened again or graph.json changes", async () => {
    const dataDir = await legacyDataDir();
    const first = await startLegacyEngine({ dataDir });
    const records = await canvasRecords(first.engine, "everything");
    const fox = byRef(records, "101")!;
    await (await first.engine.rpc()).call("testCanvas.apply", { project: "everything", change: { put: [], remove: [fox.id] }, origin: { kind: "server", id: "test" } });
    await first.engine.stop();

    const graph = join(first.folder("everything"), "graph.json");
    const text = await readFile(graph, "utf8");
    await writeFile(graph, text.replace("A @101 standing on a windswept cliff", "A @101 asleep"));

    const second = await startEngine({ dataDir, env: { UNFRAMED_TEST_CANVAS: "1" } });
    const again = await canvasRecords(second, "everything");
    expect(byRef(again, "101")).toBeUndefined();
    expect(plainText(byRef(again, "100")!.props.richText)).toBe("A @101 standing on a windswept cliff at golden hour, 35mm");
    expect(again.filter((record) => record.typeName === "shape")).toHaveLength(records.filter((record) => record.typeName === "shape").length - 1);
  });
});

describe("a failed import", () => {
  it("writes no database, says why on every open until retried, and imports once the cause is gone", async () => {
    const { engine, folder } = await startLegacyEngine();
    const graph = join(folder("everything"), "graph.json");
    await chmod(graph, 0o000);
    const rpc = await engine.rpc();
    try {
      const failure = await rpc.call("legacyImport.report", { project: "everything" }).then(
        () => undefined,
        (error: { code: string; message: string; details?: unknown }) => error,
      );
      expect(failure).toMatchObject({ code: "internal", details: { reason: "legacy_import" } });
      expect(failure!.message).toMatch(/^Could not import this project from the old Unframed: .*EACCES.*\. Its files are unchanged\.$/);
      expect(existsSync(join(folder("everything"), DATABASE))).toBe(false);
      expect(await leftovers(folder("everything"))).toEqual([]);
      expect(await rpc.call("legacyImport.status", { project: "everything" })).toEqual({ state: "failed", message: failure!.message });
      // Every opener refuses the same way, the sync socket too.
      await expect(rpc.call("testCanvas.read", { project: "everything" })).rejects.toMatchObject({ message: failure!.message });
    } finally {
      await chmod(graph, 0o644);
    }
    // The cause is gone, but nothing reruns the import until it is retried.
    await expect(rpc.call("testCanvas.read", { project: "everything" })).rejects.toMatchObject({ details: { reason: "legacy_import" } });
    const report = await rpc.call("legacyImport.retry", { project: "everything" });
    expect(report).toMatchObject({ seen: false, counts: { wiresRemoved: 14 } });
    expect(await rpc.call("legacyImport.status", { project: "everything" })).toEqual({ state: "none" });
    expect(byRef(await canvasRecords(engine, "everything"), "100")).toBeDefined();
  });

  it("answers not_found for a project that does not exist", async () => {
    const { engine } = await startLegacyEngine();
    const rpc = await engine.rpc();
    const project = { project: "no-such-project" };
    await expect(rpc.call("legacyImport.status", project)).rejects.toMatchObject({ code: "not_found" });
    await expect(rpc.call("legacyImport.report", project)).rejects.toMatchObject({ code: "not_found" });
    await expect(rpc.call("legacyImport.markSeen", project)).rejects.toMatchObject({ code: "not_found" });
    await expect(rpc.call("legacyImport.retry", project)).rejects.toMatchObject({ code: "not_found" });
  });
});
