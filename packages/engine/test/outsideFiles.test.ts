import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine } from "./agent.ts";
import { makeTempDir } from "./harness.ts";
import { chatsIn, outsideLink as outside } from "./outsideCalls.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000000c4944415408d763f8cfc0f01f0005fe02fe0ddea4070000000049454e44ae426082", "hex");

const workspace = async () => {
  const dir = await makeTempDir("unframed-agent-root-");
  const root = join(dir, "repo");
  const elsewhere = join(dir, "elsewhere");
  await mkdir(join(root, "art"), { recursive: true });
  await mkdir(elsewhere, { recursive: true });
  await writeFile(join(root, "art", "fox.png"), PNG);
  await writeFile(join(elsewhere, "secret.png"), PNG);
  return { root, elsewhere, roots: [pathToFileURL(root).href] };
};

describe("outside agents add a file from their machine (file_add)", () => {
  it("copies a file inside the client's roots as a new project file with a sidecar, answers its name, and it can be placed", async () => {
    const agent = await startAgentEngine({ env: { UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS: "300" } });
    const { root, roots } = await workspace();
    const link = await outside(agent);
    const session = await link.open();
    const added = await link.call(session, "file_add", { project: PROJECT, path: join(root, "art", "fox.png") }, roots);
    expect(added.isError).toBe(false);
    expect(added.value).toMatchObject({ fileName: "fox.png", kind: "image", mime: "image/png", bytes: PNG.length });
    const file = added.value.file as string;
    expect(file).toMatch(/^\d+-fox\.png$/);
    expect(await readFile(join(agent.folder, file))).toEqual(PNG);
    const [summary] = await chatsIn(agent);
    const sidecar = JSON.parse(await readFile(join(agent.folder, file.replace(/\.png$/, ".json")), "utf8"));
    expect(sidecar).toMatchObject({ source: "outside-agent", fileName: "fox.png", mime: "image/png", bytes: PNG.length, of: "fox.png", chat: summary!.id });
    expect(JSON.stringify(sidecar)).not.toContain(root);

    const placed = await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "create", id: "new:fox", kind: "image", x: 0, y: 0, props: { file } }] });
    expect(placed.isError).toBe(false);
    const read = await link.call(session, "canvas_read", { project: PROJECT });
    expect(read.value.shapes).toContainEqual(expect.objectContaining({ id: placed.value.ids["new:fox"], kind: "image", file }));

    const relative = await link.call(session, "file_add", { project: PROJECT, path: "art/fox.png" }, roots);
    expect(relative.value.file).not.toBe(file);
    expect(relative.value.file).toMatch(/-fox(-\d+)?\.png$/);
    const chat = await agent.settled(summary!.id, 1);
    const rows = chat.activities.filter((activity) => activity.kind === "tool.completed").map((activity) => (activity.payload as { data: { toolName: string } }).data.toolName);
    expect(rows).toContain("mcp__unframed__file_add");
  });

  it("refuses when the client reports no roots, saying why", async () => {
    const agent = await startAgentEngine();
    const { root } = await workspace();
    const link = await outside(agent);
    const session = await link.open();
    const answer = await link.call(session, "file_add", { project: PROJECT, path: join(root, "art", "fox.png") });
    expect(answer).toMatchObject({ isError: true, value: { error: expect.stringMatching(/^Your MCP client reports no working folder \(MCP roots\)/) } });
    const empty = await link.call(session, "file_add", { project: PROJECT, path: join(root, "art", "fox.png") }, []);
    expect(empty.value.error).toMatch(/^Your MCP client reports no working folder/);
  });

  it("refuses a path outside the roots, a .. escape and a symlink that leaves them, before saying whether the file exists", async () => {
    const agent = await startAgentEngine();
    const { root, elsewhere, roots } = await workspace();
    await symlink(join(elsewhere, "secret.png"), join(root, "art", "link.png"));
    const link = await outside(agent);
    const session = await link.open();
    const outsideSentence = /is outside your working folder \(.*\)\. Unframed copies only files inside the folders your MCP client reports\.$/;
    for (const path of [join(elsewhere, "secret.png"), "../elsewhere/secret.png", join(root, "..", "elsewhere", "secret.png"), "art/link.png", join(elsewhere, "missing.png")]) {
      const answer = await link.call(session, "file_add", { project: PROJECT, path }, roots);
      expect(answer.isError, path).toBe(true);
      expect(answer.value.error, path).toMatch(outsideSentence);
    }
    expect((await readdir(agent.folder)).some((name) => name.includes("secret"))).toBe(false);
  });

  it("refuses a missing file, a folder, a file the board cannot show and one over 25 MB", async () => {
    const agent = await startAgentEngine();
    const { root, roots } = await workspace();
    await writeFile(join(root, "notes.txt"), "hello");
    await mkdir(join(root, "folder.png"));
    await writeFile(join(root, "huge.mp4"), "");
    await truncate(join(root, "huge.mp4"), 26 * 1_048_576);
    const link = await outside(agent);
    const session = await link.open();
    const refusal = async (path: string) => (await link.call(session, "file_add", { project: PROJECT, path }, roots)).value.error;
    expect(await refusal("art/missing.png")).toBe("There is no file at art/missing.png.");
    expect(await refusal("folder.png")).toBe("folder.png is not a file.");
    expect(await refusal("notes.txt")).toBe("notes.txt is not a file the board can show. file_add takes PNG, JPEG, GIF, WebP and AVIF images, MP4, MOV and WebM videos, and MP3, WAV and M4A audio.");
    expect(await refusal("huge.mp4")).toBe("huge.mp4 is 26.0 MB; file_add copies files up to 25 MB.");
    expect(await refusal("")).toBe("Name the file to add with path.");
  });

  it("reads a relative path from the first root only: when it does not exist, relative paths are refused and the second root is never used", async () => {
    const agent = await startAgentEngine();
    const { root } = await workspace();
    const gone = join(root, "..", "gone");
    const roots = [pathToFileURL(gone).href, pathToFileURL(root).href];
    const link = await outside(agent);
    const session = await link.open();
    const relative = await link.call(session, "file_add", { project: PROJECT, path: "art/fox.png" }, roots);
    expect(relative.value.error).toBe(`Your first working folder (${gone}) does not exist, so a relative path has nothing to start from. Give the file's absolute path inside one of your working folders.`);
    const absolute = await link.call(session, "file_add", { project: PROJECT, path: join(root, "art", "fox.png") }, roots);
    expect(absolute.isError).toBe(false);
  });

  it("says there is no file when a folder on the way is missing, and names the roots as the client reported them", async () => {
    const agent = await startAgentEngine();
    const { root, elsewhere, roots } = await workspace();
    const link = await outside(agent);
    const session = await link.open();
    const missing = await link.call(session, "file_add", { project: PROJECT, path: join(root, "no-such-folder", "fox.png") }, roots);
    expect(missing.value.error).toBe(`There is no file at ${join(root, "no-such-folder", "fox.png")}.`);
    const refused = await link.call(session, "file_add", { project: PROJECT, path: join(elsewhere, "secret.png") }, roots);
    expect(refused.value.error).toBe(`${join(elsewhere, "secret.png")} is outside your working folder (${root}). Unframed copies only files inside the folders your MCP client reports.`);
  });

  it("refuses a named pipe or device without reading it, as not a file", async () => {
    const agent = await startAgentEngine();
    const { root, roots } = await workspace();
    execFileSync("mkfifo", [join(root, "pipe.mp4")]);
    const link = await outside(agent);
    const session = await link.open();
    const pipe = await link.call(session, "file_add", { project: PROJECT, path: "pipe.mp4" }, roots);
    expect(pipe.value.error).toBe("pipe.mp4 is not a file.");
  });
});
