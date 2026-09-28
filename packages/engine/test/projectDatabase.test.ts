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

const tables = (path: string) => {
  const db = new DatabaseSync(path);
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
  } finally {
    db.close();
  }
};

describe("project database migrations", () => {
  it("applies each migration once, records it, and applies nothing again on the next start", async () => {
    const dataDir = await makeTempDir();
    const env = { UNFRAMED_TEST_MIGRATION: "CREATE TABLE probe (id INTEGER PRIMARY KEY)" };
    const first = await startEngine({ dataDir, env });
    await (await first.rpc()).call("projects.create", { name: "One" });
    await first.stop();
    const path = join(dataDir, "output", "one", "unframed.sqlite");
    const ledger = readLedger(path).rows;
    expect(ledger.map((row) => ({ id: row.id, name: row.name }))).toEqual([{ id: 1_000_000, name: "test migration" }]);
    expect(tables(path)).toEqual(["probe", "unframed_migrations"]);

    const second = await startEngine({ dataDir, env });
    await (await second.rpc()).call("projects.create", { name: "Two" });
    await second.stop();
    expect(readLedger(path).rows).toEqual(ledger);
    expect(readLedger(join(dataDir, "output", "two", "unframed.sqlite")).rows.map((row) => row.id)).toEqual([1_000_000]);
  });

  it("rolls a failing migration back whole and answers the failure", async () => {
    const engine = await startEngine({
      env: { UNFRAMED_TEST_MIGRATION: "CREATE TABLE probe (id INTEGER); INSERT INTO no_such_table VALUES (1)" },
    });
    const failure = await (await engine.rpc()).call("projects.create", { name: "Broken" }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "internal" });
    expect((failure as Error).message).toMatch(/^Could not create the project: .*no such table: no_such_table/);
    await engine.stop();
    const path = join(engine.dataDir, "output", "broken", "unframed.sqlite");
    expect(tables(path)).toEqual(["unframed_migrations"]);
    expect(readLedger(path).rows).toEqual([]);
  });
});

describe("project database after an output folder change", () => {
  it("opens the database in the new folder for a project name already opened in the old one", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "Board" });
    const elsewhere = await makeTempDir("unframed-out-");
    await rpc.call("settings.update", { outputDir: elsewhere });
    await rpc.call("projects.create", { name: "Board" });
    expect(await readdir(join(elsewhere, "board"))).toContain("unframed.sqlite");
    expect((await engine.stop()).code).toBe(0);
    expect(readLedger(join(elsewhere, "board", "unframed.sqlite")).journal).toBe("wal");
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
