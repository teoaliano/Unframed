import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { fileDigests, legacyDataDir, startLegacyEngine } from "./legacy.ts";

const EVERYTHING_ITEMS = [
  ["changed", "Wires are gone: the selection is the input now. 14 wires were removed."],
  ["notKept", "graph.log has an unreadable line 13. Changes after it were not imported."],
  ["notKept", "A node of unknown type sticky (id 220) was not imported."],
  ["changed", "@210 belonged to a group that no longer exists. It is now on the canvas at its old offset."],
  ["missing", "Image @109 named 1789031280088-gone.png, which is not in the project folder. It is empty now."],
  ["changed", "@140 was an image output. It is now a recipe group around its 2 sources."],
  ["missing", "1 results of @140 are no longer in the project folder."],
  ["changed", "@132 was a text output whose sources also fed other outputs, or could not be boxed cleanly. It is now a recipe group where it stood. Select it with its sources to run it."],
  ["notKept", "@132 was a text output with no answer yet. Prompts that mention @132 now show the token as typed."],
  ["changed", "@151 was a text output whose sources also fed other outputs, or could not be boxed cleanly. It is now a recipe group where it stood. Select it with its sources to run it."],
  ["changed", "@151 was a text output. Its answer is now a text result with the same @id."],
  ["changed", "@150 was an image output whose sources also fed other outputs, or could not be boxed cleanly. It is now a recipe group where it stood. Select it with its sources to run it."],
  ["changed", "@160 was a video output. It is now a recipe group around its 2 sources."],
  ["changed", "@163 was a video output. It is now a recipe group around its 1 sources."],
  ["changed", "@163 had a render in flight. It is still tracked and lands here when it finishes."],
  ["changed", "@170 was a text output. It is now a recipe group around its 1 sources."],
  ["changed", "@170 was a text output. Its answer is now a text result with the same @id."],
  ["changed", "Its instructions are now the prompt @217."],
  ["changed", "@133 was a text output. It is now a recipe group around its 1 sources."],
  ["notKept", "@133 was a text output with no answer yet. Prompts that mention @133 now show the token as typed."],
  ["changed", "Its instructions are now the prompt @219."],
  ["changed", "@180 was an image output wired from @character. @character now holds its settings."],
  ["changed", "@130 was an image output with no sources. It is now a recipe group where it stood."],
  ["changed", "@131 was a video output with no sources. It is now a recipe group where it stood."],
  ["notKept", "@131's render failed: The provider rejected the request: duration must be 4, 5, 6 or 8 seconds."],
  ["changed", "@190 was an image output whose sources also fed other outputs, or could not be boxed cleanly. It is now a recipe group where it stood. Select it with its sources to run it."],
  ["notKept", "@190 had a run in flight when the old app last saved. It was not resumed. Any image it finished is in the project folder."],
  ["notKept", "Old chats in threads/ are not shown in this version. Their files are still in the project folder."],
].map(([section, text]) => ({ section, text }));

describe("the import report", () => {
  it("is stored with the import: its source, counts and every item in its section", async () => {
    const { engine } = await startLegacyEngine();
    const rpc = await engine.rpc();
    const before = Date.now();
    const report = await rpc.call("legacyImport.report", { project: "everything" });
    expect(report).toEqual({
      importedAt: expect.any(String),
      source: { snapshotVersion: 4, journalEntriesApplied: 6, journalStoppedAtLine: 13 },
      counts: { prompts: 15, images: 9, videos: 3, groups: 0, recipeGroups: 12, results: 6, pages: 1, motions: 1, wiresRemoved: 14, filesExtracted: 1 },
      items: EVERYTHING_ITEMS,
      seen: false,
    });
    expect(Date.parse(report!.importedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(await rpc.call("legacyImport.report", { project: "legacy-snapshot" })).toMatchObject({
      source: { snapshotVersion: null, journalEntriesApplied: 0 },
      counts: { recipeGroups: 2, results: 2, filesExtracted: 2, wiresRemoved: 0 },
      items: [
        { section: "changed", text: "@102 was an image output with no sources. It is now a recipe group where it stood." },
        { section: "changed", text: "@103 was a video output with no sources. It is now a recipe group where it stood." },
      ],
    });
    expect(await rpc.call("legacyImport.report", { project: "broken-snapshot" })).toMatchObject({
      source: { snapshotVersion: null, journalEntriesApplied: 3 },
      items: [
        { section: "changed", text: "Wires are gone: the selection is the input now. 2 wires were removed." },
        { section: "notKept", text: "graph.json could not be read, so the canvas was rebuilt from graph.log." },
        { section: "changed", text: "@102 was a video output. It is now a recipe group around its 2 sources." },
        { section: "notKept", text: "@102 was waiting for a render the job store no longer knows about. Nothing was resumed." },
      ],
    });
  });

  it("is seen once marked, across restarts", async () => {
    const dataDir = await legacyDataDir();
    const first = await startLegacyEngine({ dataDir });
    const rpc = await first.engine.rpc();
    expect((await rpc.call("legacyImport.report", { project: "everything" }))!.seen).toBe(false);
    expect(await rpc.call("legacyImport.markSeen", { project: "everything" })).toEqual({});
    expect((await rpc.call("legacyImport.report", { project: "everything" }))!.seen).toBe(true);
    expect((await rpc.call("legacyImport.report", { project: "legacy-snapshot" }))!.seen).toBe(false);
    await first.engine.stop();
    const second = await startEngine({ dataDir, env: { UNFRAMED_TEST_CANVAS: "1" } });
    expect((await (await second.rpc()).call("legacyImport.report", { project: "everything" }))!.seen).toBe(true);
  });

  it("is null for a project that was never imported, and marking it seen changes nothing", async () => {
    const { engine } = await startLegacyEngine();
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "fresh" });
    expect(await rpc.call("legacyImport.report", { project: "fresh" })).toBeNull();
    expect(await rpc.call("legacyImport.markSeen", { project: "fresh" })).toEqual({});
    expect(await rpc.call("legacyImport.report", { project: "fresh" })).toBeNull();
    expect(await rpc.call("legacyImport.status", { project: "fresh" })).toEqual({ state: "none" });
  });
});

describe("old chats", () => {
  it("are named in the report when threads/ holds files, and their files stay untouched", async () => {
    const dataDir = await legacyDataDir();
    await mkdir(join(dataDir, "output", "legacy-snapshot", "threads"));
    const { engine, folder } = await startLegacyEngine({ dataDir });
    const threads = await fileDigests(join(folder("everything"), "threads"));
    const rpc = await engine.rpc();
    const chats = "Old chats in threads/ are not shown in this version. Their files are still in the project folder.";
    expect((await rpc.call("legacyImport.report", { project: "everything" }))!.items.map((item) => item.text)).toContain(chats);
    // An empty threads/ says nothing.
    expect((await rpc.call("legacyImport.report", { project: "legacy-snapshot" }))!.items.map((item) => item.text)).not.toContain(chats);
    expect(await fileDigests(join(folder("everything"), "threads"))).toEqual(threads);
    expect(Object.keys(threads)).toEqual(["t-mfd3k8q2-4c7e9a1d.json"]);
    // The chat store shows none of them.
    const shell = rpc.subscribe("orchestration.subscribeShell", { projectId: "everything" });
    const first = await shell.next(0);
    expect(JSON.stringify(first)).not.toContain("t-mfd3k8q2-4c7e9a1d");
  });

  it("put a file in threads/ that the report counts", async () => {
    const dataDir = await legacyDataDir();
    await mkdir(join(dataDir, "output", "legacy-snapshot", "threads"));
    await writeFile(join(dataDir, "output", "legacy-snapshot", "threads", "t-1.json"), "{}");
    const { engine } = await startLegacyEngine({ dataDir });
    const items = (await (await engine.rpc()).call("legacyImport.report", { project: "legacy-snapshot" }))!.items;
    expect(items.at(-1)).toEqual({ section: "notKept", text: "Old chats in threads/ are not shown in this version. Their files are still in the project folder." });
  });
});
