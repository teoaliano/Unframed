import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine } from "./harness.ts";

// Opened read-write so that closing, as the last connection, removes the -wal and -shm
// files it creates, and the folder listing afterwards shows only what the engine left.
const readLedger = (path: string) => {
  const db = new DatabaseSync(path);
  try {
    const journal = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    const rows = db.prepare("SELECT id, name, applied_at FROM unframed_migrations ORDER BY id").all();
    return { journal: journal.journal_mode, rows };
  } finally {
    db.close();
  }
};

describe("project database", () => {
  it("leaves unframed.sqlite in a new project with the migration list applied once, and nothing applied again on restart", async () => {
    const dataDir = await makeTempDir();
    const first = await startEngine({ dataDir });
    await (await first.rpc()).call("projects.create", { name: "Board" });
    expect((await first.stop()).code).toBe(0);

    const folder = join(dataDir, "output", "board");
    expect((await readdir(folder)).sort()).toEqual(["unframed.sqlite"]);
    const before = readLedger(join(folder, "unframed.sqlite"));
    expect(before.journal).toBe("wal");
    expect(before.rows.map((row) => row.id)).toEqual(before.rows.map((_, index) => index + 1));

    const second = await startEngine({ dataDir });
    const rpc = await second.rpc();
    expect(await rpc.call("projects.list")).toEqual({ projects: ["board"] });
    await rpc.call("projects.create", { name: "Other" });
    expect((await second.stop()).code).toBe(0);

    expect(readLedger(join(folder, "unframed.sqlite")).rows).toEqual(before.rows);
    expect(readLedger(join(dataDir, "output", "other", "unframed.sqlite")).rows.map((row) => row.id)).toEqual(
      before.rows.map((row) => row.id),
    );
    const sqliteFiles = (await readdir(folder)).filter((name) => name.includes("sqlite") || name.endsWith(".db"));
    expect(sqliteFiles).toEqual(["unframed.sqlite"]);
  });
});

describe("open-project registry", () => {
  it("closes an opened project database on SIGTERM within the budget, leaving no -wal file", async () => {
    const engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "Wal Check" });
    const folder = join(engine.dataDir, "output", "wal-check");
    expect(await readdir(folder)).toContain("unframed.sqlite-wal");

    const started = Date.now();
    const exit = await engine.stop("SIGTERM");
    expect(exit.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await readdir(folder)).toEqual(["unframed.sqlite"]);
    expect(engine.stderr()).toBe("");
  });
});
