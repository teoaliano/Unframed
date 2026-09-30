import { describe, expect, it } from "vitest";
import { rebuild } from "../../src/index.ts";
import { entry, journal, prompt, snapshot } from "./journal.ts";
import { sampleText } from "./samples.ts";

const texts = (graph: { nodes: ReadonlyArray<{ id: string; data: Readonly<Record<string, unknown>> }> }) =>
  Object.fromEntries(graph.nodes.map((node) => [node.id, node.data.text]));

describe("rebuild: a snapshot and its journal", () => {
  it("applies only the entries above the snapshot's version, in file order", () => {
    const log = [
      entry(1, { type: "updateNode", id: "100", patch: { text: "one" } }),
      entry(2, { type: "updateNode", id: "100", patch: { text: "two" } }),
      entry(3, { type: "updateNode", id: "100", patch: { text: "three" } }),
      entry(4, { type: "updateNode", id: "100", patch: { text: "four" } }),
    ].join("\n");
    const { graph, stats, notes } = rebuild(snapshot([prompt("100", "two")], [], 2), log);
    expect(texts(graph)).toEqual({ "100": "four" });
    expect(stats).toEqual({ snapshotVersion: 2, journalEntriesApplied: 2 });
    expect(notes).toEqual([]);
  });

  it("skips a rejected entry and goes on, and a later entry still has to be above the last applied version", () => {
    const log = [
      entry(2, { type: "updateNode", id: "999", patch: { text: "nobody" } }),
      entry(3, { type: "updateNode", id: "100", patch: { text: "three" } }),
      entry(3, { type: "updateNode", id: "100", patch: { text: "a second 3" } }),
      entry(4, { type: "updateNode", id: "100", patch: { text: "four" } }),
    ].join("\n");
    const { graph, stats } = rebuild(snapshot([prompt("100", "one")]), log);
    expect(texts(graph)).toEqual({ "100": "four" });
    expect(stats.journalEntriesApplied).toBe(2);
  });

  it("skips blank lines and stops at the first line that is not valid JSON, keeping the entries before it", () => {
    const log = [
      entry(2, { type: "updateNode", id: "100", patch: { text: "two" } }),
      "",
      "   ",
      '{"version":3,"op":{"type":"updateNode","id":"100","pat',
      entry(4, { type: "updateNode", id: "100", patch: { text: "four" } }),
    ].join("\n");
    const { graph, stats, notes } = rebuild(snapshot([prompt("100", "one")]), log);
    expect(texts(graph)).toEqual({ "100": "two" });
    expect(stats).toEqual({ snapshotVersion: 1, journalEntriesApplied: 1, journalStoppedAtLine: 4 });
    expect(notes).toEqual([{ section: "notKept", text: "graph.log has an unreadable line 4. Changes after it were not imported." }]);
  });

  it("rebuilds the everything sample as the old app would have shown it", () => {
    const { graph, stats, notes } = rebuild(sampleText("everything/graph.json"), sampleText("everything/graph.log"));
    expect(stats).toEqual({ snapshotVersion: 4, journalEntriesApplied: 6, journalStoppedAtLine: 13 });
    expect(notes).toEqual([{ section: "notKept", text: "graph.log has an unreadable line 13. Changes after it were not imported." }]);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    // Entry 5 adds the agent's prompt, entry 11 moves it.
    expect(byId.get("a-mfd4b1x9-q7c3v1")).toMatchObject({ position: { x: 1300, y: 2640 }, data: { text: "Morning fog over the water" } });
    // Entry 6 retypes and resizes 101, and deletes 134's stray size.
    expect(byId.get("101")).toMatchObject({ width: 124, height: 30, data: { text: "lone red fox" } });
    expect(byId.get("134")!.data).not.toHaveProperty("size");
    // Entry 7 renames the group and rewrites the prompt that named it.
    expect(byId.has("hero")).toBe(false);
    expect(byId.get("character")).toMatchObject({ type: "group" });
    expect(byId.get("120")!.parentId).toBe("character");
    expect(byId.get("103")!.data.text).toBe("@character looks out over the sea");
    expect(graph.edges.find((edge) => edge.id === "e-hero-180")).toMatchObject({ source: "character", target: "180" });
    // Entries 8 and 9 remove 104 and put it back at index 5.
    expect(graph.nodes[5]!.id).toBe("104");
    // Entry 10 is rejected: an output cannot be a member.
    expect(byId.get("180")!.parentId).toBeUndefined();
    // The journal set aside by the old app is never read.
    expect(byId.get("101")!.data.text).not.toBe("arctic fox");
    expect(graph.nodes).toHaveLength(42);
  });
});

describe("rebuild: the snapshot rules", () => {
  it("lets a snapshot with no version win over a journal with entries, ignoring the journal entirely", () => {
    const { graph, stats, notes } = rebuild(sampleText("legacy-snapshot/graph.json"), sampleText("legacy-snapshot/graph.log"));
    expect(texts(graph)["100"]).toBe("A fox running along the beach at low tide");
    expect(graph.nodes.map((node) => node.id)).toEqual(["100", "101", "102", "103"]);
    expect(graph.edges).toEqual([]);
    expect(stats).toEqual({ snapshotVersion: null, journalEntriesApplied: 0 });
    expect(notes).toEqual([]);
  });

  it("applies a journal over a snapshot with no version when the journal holds no entries", () => {
    const { graph, stats } = rebuild(snapshot([prompt("100", "fox")], [], null), "\n\n");
    expect(texts(graph)).toEqual({ "100": "fox" });
    expect(stats).toEqual({ snapshotVersion: null, journalEntriesApplied: 0 });
  });

  it("rebuilds from the journal when the snapshot cannot be read, and notes it", () => {
    const { graph, stats, notes } = rebuild(sampleText("broken-snapshot/graph.json"), sampleText("broken-snapshot/graph.log"));
    expect(graph.nodes.map((node) => [node.id, node.type])).toEqual([
      ["100", "prompt"],
      ["101", "image"],
      ["102", "videoOutput"],
    ]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["e-100-102", "e-101-102"]);
    expect(graph.nodes[2]!.data.job).toMatchObject({ id: "vid_9a1c7e3b58" });
    expect(stats).toEqual({ snapshotVersion: null, journalEntriesApplied: 3 });
    expect(notes).toEqual([{ section: "notKept", text: "graph.json could not be read, so the canvas was rebuilt from graph.log." }]);
  });

  it("reads a snapshot whose nodes is not a list as unreadable", () => {
    const { graph, notes } = rebuild(JSON.stringify({ version: 3, nodes: { a: 1 } }), null);
    expect(graph.nodes).toEqual([]);
    expect(notes).toEqual([{ section: "notKept", text: "graph.json could not be read, so the canvas was rebuilt from graph.log." }]);
  });

  it("reads a snapshot with no edges key as having none", () => {
    expect(rebuild(JSON.stringify({ version: 1, nodes: [prompt("100")] }), null).graph.edges).toEqual([]);
  });

  it("starts empty at version 0 when there is neither file, and applies a journal from version 1", () => {
    expect(rebuild(null, null)).toEqual({ graph: { nodes: [], edges: [] }, stats: { snapshotVersion: null, journalEntriesApplied: 0 }, notes: [] });
    const { graph, stats } = rebuild(null, journal([{ type: "addNode", node: prompt("100", "fox") }], 1));
    expect(texts(graph)).toEqual({ "100": "fox" });
    expect(stats.journalEntriesApplied).toBe(1);
  });
});
