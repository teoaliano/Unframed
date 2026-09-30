import { describe, expect, it } from "vitest";
import { normalise, rebuild, type LegacyGraph } from "../../src/index.ts";
import { edge, group, image, imageOutput, prompt, type Json } from "./journal.ts";
import { sampleText } from "./samples.ts";

const graphOf = (nodes: Json[], edges: Json[] = []): LegacyGraph => ({ nodes, edges }) as unknown as LegacyGraph;

describe("normalise: types, keys and edges", () => {
  it("migrates a legacy output by its kind, and a legacy text to a text output", () => {
    const { graph } = normalise(
      graphOf([
        { id: "130", type: "output", position: { x: 0, y: 0 }, data: { kind: "image", model: "openai/gpt-image-2", runs: 2 } },
        { id: "131", type: "output", position: { x: 0, y: 0 }, data: { kind: "video", videoModel: "bytedance/seedance-2.0" } },
        { id: "134", type: "output", position: { x: 0, y: 0 }, data: { model: "openai/gpt-image-2" } },
        { id: "132", type: "text", position: { x: 0, y: 0 }, data: { text: "", result: "" } },
      ]),
    );
    expect(graph.nodes.map((node) => [node.id, node.type, node.data])).toEqual([
      ["130", "imageOutput", { model: "openai/gpt-image-2", runs: 2 }],
      ["131", "videoOutput", { videoModel: "bytedance/seedance-2.0" }],
      ["134", "imageOutput", { model: "openai/gpt-image-2" }],
      ["132", "textOutput", { text: "", result: "" }],
    ]);
  });

  it("drops a node of unknown type and reports it", () => {
    const { graph, notes } = normalise(graphOf([prompt("100"), { id: "220", type: "sticky", position: { x: 0, y: 0 }, data: { text: "note" } }]));
    expect(graph.nodes.map((node) => node.id)).toEqual(["100"]);
    expect(notes).toEqual([{ section: "notKept", text: "A node of unknown type sticky (id 220) was not imported." }]);
  });

  it("keeps only a node's own keys, whatever stale state it carries", () => {
    const { graph } = normalise(
      graphOf([{ ...prompt("100", "fox"), width: 320, height: 100, selected: true, dragging: false, measured: { width: 320, height: 100 }, extent: "parent", zIndex: 4 }]),
    );
    expect(graph.nodes).toEqual([{ id: "100", type: "prompt", position: { x: 0, y: 0 }, width: 320, height: 100, data: { text: "fox" } }]);
  });

  it("drops edges whose ends do not both exist, and the extra keys of the rest", () => {
    const { graph } = normalise(
      graphOf([prompt("100"), imageOutput("140"), { id: "220", type: "sticky", position: { x: 0, y: 0 }, data: {} }], [
        edge("100", "140", { animated: true, sourceHandle: "out", targetHandle: "in" }),
        edge("220", "140"),
        edge("100", "gone"),
      ]),
    );
    expect(graph.edges).toEqual([{ id: "e-100-140", source: "100", target: "140", animated: true }]);
  });
});

describe("normalise: membership and ids", () => {
  it("puts a member whose group is gone on the canvas at its old offset, and reports it", () => {
    const { graph, notes } = normalise(
      graphOf([image("210", { parentId: "old-box", position: { x: 1300, y: 2150 } }), prompt("100"), image("211", { parentId: "100", position: { x: 5, y: 6 } })]),
    );
    expect(graph.nodes.find((node) => node.id === "210")).toEqual({ id: "210", type: "image", position: { x: 1300, y: 2150 }, width: 240, data: { fileName: "" } });
    expect(graph.nodes.find((node) => node.id === "211")).toMatchObject({ position: { x: 5, y: 6 } });
    expect(graph.nodes.find((node) => node.id === "211")).not.toHaveProperty("parentId");
    expect(notes).toEqual([
      { section: "changed", text: "@210 belonged to a group that no longer exists. It is now on the canvas at its old offset." },
      { section: "changed", text: "@211 belonged to a group that no longer exists. It is now on the canvas at its old offset." },
    ]);
  });

  it("puts a member that cannot be a member beside its group, at its absolute position, and reports it", () => {
    const { graph, notes } = normalise(
      graphOf([
        group("box", { position: { x: 100, y: 200 } }),
        imageOutput("140", { parentId: "box", position: { x: 10, y: 20 } }),
        group("inner", { parentId: "box", position: { x: 30, y: 40 } }),
        { id: "200", type: "page", parentId: "box", position: { x: 1, y: 2 }, data: { file: "", title: "", fileName: "" } },
        prompt("120", "kept", { parentId: "box", position: { x: 28, y: 56 } }),
      ]),
    );
    const at = (id: string) => graph.nodes.find((node) => node.id === id);
    expect(at("140")).toMatchObject({ position: { x: 110, y: 220 } });
    expect(at("140")).not.toHaveProperty("parentId");
    expect(at("inner")).toMatchObject({ position: { x: 130, y: 240 } });
    expect(at("200")).toMatchObject({ position: { x: 101, y: 202 } });
    expect(at("120")).toMatchObject({ parentId: "box", position: { x: 28, y: 56 } });
    expect(notes.map((note) => note.text)).toEqual([
      "@140 was inside a group but cannot be a member here. It is now beside it.",
      "@inner was inside a group but cannot be a member here. It is now beside it.",
      "@200 was inside a group but cannot be a member here. It is now beside it.",
    ]);
  });

  it("gives an id that cannot be an @id a fresh minted one, and its edges and members follow it", () => {
    const { graph } = normalise(
      graphOf(
        [
          prompt("150", "see @170 and @300"),
          group("my box", { position: { x: 0, y: 0 } }),
          prompt("120", "", { parentId: "my box" }),
          imageOutput("out/1"),
          { id: "170", type: "textOutput", position: { x: 0, y: 0 }, data: { text: "@400", result: "" } },
        ],
        [edge("my box", "out/1")],
      ),
    );
    expect(graph.nodes.map((node) => node.id)).toEqual(["150", "401", "120", "402", "170"]);
    expect(graph.nodes[2]!.parentId).toBe("401");
    expect(graph.edges).toEqual([{ id: "e-my box-out/1", source: "401", target: "402" }]);
    expect(graph.nodes[0]!.data.text).toBe("see @170 and @300");
  });

  it("repairs the everything sample: the orphan comes out, the sticky goes", () => {
    const rebuilt = rebuild(sampleText("everything/graph.json"), sampleText("everything/graph.log"));
    const { graph, notes } = normalise(rebuilt.graph);
    expect(graph.nodes.find((node) => node.id === "210")).toMatchObject({ position: { x: 1300, y: 2150 } });
    expect(graph.nodes.some((node) => node.id === "220")).toBe(false);
    expect(graph.nodes.find((node) => node.id === "130")!.type).toBe("imageOutput");
    expect(graph.nodes.find((node) => node.id === "131")!.type).toBe("videoOutput");
    expect(graph.nodes.find((node) => node.id === "132")!.type).toBe("textOutput");
    expect(graph.nodes.find((node) => node.id === "100")).not.toHaveProperty("selected");
    expect(graph.edges).toHaveLength(14);
    expect(notes).toEqual([
      { section: "notKept", text: "A node of unknown type sticky (id 220) was not imported." },
      { section: "changed", text: "@210 belonged to a group that no longer exists. It is now on the canvas at its old offset." },
    ]);
  });
});
