import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { revealPlan } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine, type TestEngine } from "./harness.ts";

const seedProject = async (engine: TestEngine) => {
  const folder = join(engine.dataDir, "output", "board");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "a.png"), "a");
  await writeFile(join(folder, "b.png"), "b");
  return folder;
};

describe("files.reveal hosted", () => {
  it("sends the absolute paths of existing files to the shell and spawns nothing", async () => {
    const engine = await startEngine({ clientDist: await makeTempDir("unframed-client-") });
    const folder = await seedProject(engine);
    const rpc = await engine.rpc();
    const answer = await rpc.call("files.reveal", { project: "Board", fileNames: ["a.png", "missing.png", "../../b.png"] });
    expect(answer).toEqual({ revealed: 2 });
    const reveal = await engine.waitForMessage((message) => message.type === "reveal");
    expect(reveal).toEqual({ type: "reveal", files: [join(folder, "a.png"), join(folder, "b.png")] });
    expect(await engine.nativeLog()).toEqual([]);
  });

  it("sends [folder] when no named file exists", async () => {
    const engine = await startEngine({ clientDist: await makeTempDir("unframed-client-") });
    const folder = await seedProject(engine);
    const answer = await (await engine.rpc()).call("files.reveal", { project: "board", fileNames: ["gone.png"] });
    expect(answer).toEqual({ revealed: "folder" });
    expect(await engine.waitForMessage((message) => message.type === "reveal")).toEqual({ type: "reveal", files: [folder] });
  });

  it("reveals in the output folder when no project is given", async () => {
    const engine = await startEngine({ clientDist: await makeTempDir("unframed-client-") });
    await seedProject(engine);
    await writeFile(join(engine.dataDir, "output", "jobs.json"), "[]");
    const answer = await (await engine.rpc()).call("files.reveal", { fileNames: ["jobs.json"] });
    expect(answer).toEqual({ revealed: 1 });
    expect(await engine.waitForMessage((message) => message.type === "reveal")).toEqual({
      type: "reveal",
      files: [join(engine.dataDir, "output", "jobs.json")],
    });
  });
});

describe("files.reveal gating", () => {
  it("with an IPC channel but no UNFRAMED_CLIENT_DIST sends nothing over IPC and runs the standalone command", async () => {
    const engine = await startEngine();
    const folder = await seedProject(engine);
    const answer = await (await engine.rpc()).call("files.reveal", { project: "board", fileNames: ["a.png"] });
    const plan = revealPlan(process.platform, [join(folder, "a.png")], folder);
    expect(answer).toEqual({ revealed: plan.revealed });
    expect(await engine.nativeLog()).toEqual([{ cmd: plan.command.cmd, args: plan.command.args }]);
    expect(engine.messages.filter((message) => message.type === "reveal")).toEqual([]);
  });

  it("without an IPC channel runs the standalone command even when UNFRAMED_CLIENT_DIST is set", async () => {
    const engine = await startEngine({ ipc: false, clientDist: await makeTempDir("unframed-client-") });
    const folder = await seedProject(engine);
    await (await engine.rpc()).call("files.reveal", { project: "board", fileNames: [] });
    const plan = revealPlan(process.platform, [], folder);
    expect(await engine.nativeLog()).toEqual([{ cmd: plan.command.cmd, args: plan.command.args }]);
  });
});

describe("files.reveal without a folder", () => {
  it("answers not_found for a project with no folder", async () => {
    const engine = await startEngine();
    const rpc = await engine.rpc();
    for (const project of ["never-made", "!!!"]) {
      await expect(rpc.call("files.reveal", { project, fileNames: ["a.png"] })).rejects.toMatchObject({
        code: "not_found",
        message: "No files for this project yet.",
      });
    }
    expect(await engine.nativeLog()).toEqual([]);
  });
});

describe("files.path", () => {
  it("answers a project file's absolute path, from its basename", async () => {
    const engine = await startEngine();
    const folder = await seedProject(engine);
    const rpc = await engine.rpc();
    expect(await rpc.call("files.path", { project: "Board", fileName: "a.png" })).toEqual({ path: join(folder, "a.png") });
    expect(await rpc.call("files.path", { project: "board", fileName: "../../b.png" })).toEqual({ path: join(folder, "b.png") });
    expect(await engine.nativeLog()).toEqual([]);
  });

  it("answers not_found for a file that is not on disk and for a project with no folder", async () => {
    const engine = await startEngine();
    await seedProject(engine);
    const rpc = await engine.rpc();
    for (const fileName of ["gone.png", ".."]) {
      await expect(rpc.call("files.path", { project: "board", fileName })).rejects.toMatchObject({ code: "not_found", message: `No file ${fileName} in this project.` });
    }
    await expect(rpc.call("files.path", { project: "never-made", fileName: "a.png" })).rejects.toMatchObject({
      code: "not_found",
      message: "No files for this project yet.",
    });
  });
});
