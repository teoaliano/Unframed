import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("projects.list", () => {
  it("creates a missing output folder and lists nothing", async () => {
    const engine = await startEngine({ dotenv: "OUTPUT_DIR=./not/there/yet\n" });
    const output = join(engine.dataDir, "not/there/yet");
    await expect(stat(output)).rejects.toThrow();
    expect(await (await engine.rpc()).call("projects.list")).toEqual({ projects: [] });
    expect((await stat(output)).isDirectory()).toBe(true);
  });

  it("lists only the direct subdirectories, sorted by name, ignoring jobs.json and presets.json", async () => {
    const engine = await startEngine();
    const output = join(engine.dataDir, "output");
    for (const name of ["zebra", "alpha", "middle-2", "10-numbers"]) await mkdir(join(output, name), { recursive: true });
    await mkdir(join(output, "alpha", "nested"), { recursive: true });
    await writeFile(join(output, "jobs.json"), "[]");
    await writeFile(join(output, "presets.json"), "[]");
    await writeFile(join(output, "stray.png"), "");
    expect(await (await engine.rpc()).call("projects.list")).toEqual({
      projects: ["10-numbers", "alpha", "middle-2", "zebra"],
    });
  });

  it("answers internal when the output folder path is taken by a file, and keeps answering", async () => {
    const engine = await startEngine({ dotenv: "OUTPUT_DIR=./blocked\n" });
    await writeFile(join(engine.dataDir, "blocked"), "a file where the folder should be");
    const rpc = await engine.rpc();
    const failure = await rpc.call("projects.list").catch((error: unknown) => error);
    expect(failure).toMatchObject({ _tag: "UnframedError", code: "internal" });
    expect((failure as Error).message).toMatch(/^Could not list the output folder: .+/);
    expect((await rpc.call("server.health")).ok).toBe(true);
    expect(await readdir(engine.dataDir)).toContain("blocked");
  });
});

describe("projects.create", () => {
  it("slugs the name, creates the folder and answers the slug", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    expect(await rpc.call("projects.create", { name: "  My First Board!  " })).toEqual({ name: "my-first-board" });
    expect((await stat(join(engine.dataDir, "output", "my-first-board"))).isDirectory()).toBe(true);
    expect(await rpc.call("projects.list")).toEqual({ projects: ["my-first-board"] });
  });

  it("refuses a name whose slug is taken with conflict", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "Moodboard" });
    await expect(rpc.call("projects.create", { name: "MOODBOARD" })).rejects.toMatchObject({
      code: "conflict",
      message: 'A project named "moodboard" already exists.',
    });
    await mkdir(join(engine.dataDir, "output", "made-by-hand"));
    await expect(rpc.call("projects.create", { name: "made by hand" })).rejects.toMatchObject({
      code: "conflict",
      message: 'A project named "made-by-hand" already exists.',
    });
  });

  it("refuses a name with an empty slug", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    for (const name of ["", "   ", "!!!", "../.."]) {
      await expect(rpc.call("projects.create", { name })).rejects.toMatchObject({
        code: "bad_request",
        message: "Enter a project name.",
      });
    }
    expect(await rpc.call("projects.list")).toEqual({ projects: [] });
  });

  it("keeps a name inside the output folder", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    expect(await rpc.call("projects.create", { name: "../../escape" })).toEqual({ name: "escape" });
    expect(await readdir(engine.dataDir)).not.toContain("escape");
    expect(await readdir(join(engine.dataDir, "output"))).toEqual(["escape"]);
  });

  it("answers internal when the folder cannot be created", async () => {
    const engine = await startEngine();
    await mkdir(join(engine.dataDir, "output"), { recursive: true });
    await writeFile(join(engine.dataDir, "output", "taken-by-file"), "");
    const failure = await (await engine.rpc()).call("projects.create", { name: "taken by file" }).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: "internal" });
    expect((failure as Error).message).toMatch(/^Could not create the project: .+/);
  });
});
