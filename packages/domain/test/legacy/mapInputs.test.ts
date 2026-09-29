import { describe, expect, it } from "vitest";
import { legacyRecords, nextRef } from "../../src/index.ts";
import { mapSample, shapesOf } from "./facts.ts";
import { group, image, prompt } from "./journal.ts";
import { at, mapNodes, PNG_64x40, section } from "./mapping.ts";

const ids = { page: "page:page", shape: (key: string) => `shape:${key}`, asset: (key: string) => `asset:${key}` };

describe("prompts", () => {
  it("keep their @id and text; a sized prompt keeps its size fixed and any other hugs its text", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("100")).toMatchObject({ kind: "prompt", text: "A @101 standing on a windswept cliff at golden hour, 35mm", sized: true, w: 320, h: 100 });
    expect(ref("101")).toMatchObject({ kind: "prompt", text: "lone red fox", sized: false, w: 124, h: 30 });
    expect(ref("103").text).toBe("@character looks out over the sea");
    expect(ref("104").text).toBe("Add a small @lighthouse far out at sea");
    expect(ref("a-mfd4b1x9-q7c3v1")).toMatchObject({ text: "Morning fog over the water", x: 1300, y: 2640 });
  });

  it("keep their position, and take 240 by 160 when the old node had no size", () => {
    const { ref } = shapesOf(mapNodes([prompt("100", "fox", at(40, 60))]));
    expect(ref("100")).toMatchObject({ x: 40, y: 60, w: 240, h: 160, sized: false });
  });

  it("become text shapes with the @id in meta.ref and meta.sized", () => {
    const mapped = mapNodes([prompt("100", "fox\n\ncliff", { data: { text: "fox\n\ncliff", sized: true }, width: 300 })]);
    const [record] = legacyRecords(mapped.canvas.shapes, ids).shapes;
    expect(record).toMatchObject({
      type: "text",
      parentId: "page:page",
      props: {
        w: 300,
        autoSize: false,
        richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "fox" }] }, { type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "cliff" }] }] },
      },
      meta: { ref: "100", sized: true },
    });
  });

  it("leave nothing a later mint could reissue: the next @id is past every imported one and every numeric token", () => {
    const mapped = mapSample("everything");
    const { shapes } = legacyRecords(mapped.canvas.shapes, ids);
    const refs = mapped.canvas.shapes.map((shape) => shape.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(nextRef(shapes)).toBe("220");
    const tokens = mapNodes([prompt("100", "see @500"), { id: "133", type: "textOutput", ...at(400, 0), data: { text: "Caption it.", result: "" } }]);
    expect(shapesOf(tokens).key("group:133").ref).toBe("501");
  });
});

describe("images", () => {
  it("name their file when it is in the folder, with the height from the aspect in data", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("152")).toMatchObject({ kind: "image", w: 240, h: 150, media: { kind: "file", file: "1789030980033-sea.png", name: "sea.png", mime: "image/png", w: 64, h: 40 } });
  });

  it("take the height from the image file's header when data has no aspect", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("106")).toMatchObject({ w: 240, h: 150, media: { file: "1789030860011-cliff.png" } });
  });

  it("extract an inline data URL to a deterministic file", () => {
    const mapped = mapSample("everything");
    expect(shapesOf(mapped).ref("107")).toMatchObject({ h: 150, media: { kind: "file", file: "legacy-5c59251f1b05f008-sketch.png", name: "sketch.png", mime: "image/png", w: 64, h: 40 } });
    expect(mapped.extractions.map((each) => [each.file, each.mime, each.fileName, each.bytes.length])).toEqual([["legacy-5c59251f1b05f008-sketch.png", "image/png", "sketch.png", 154]]);
  });

  it("are empty with no file and no data URL, with a height of the width over 1", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("108")).toMatchObject({ w: 240, h: 240 });
    expect(ref("108").media).toBeUndefined();
  });

  it("are empty when their file is missing, and the report says which", () => {
    const mapped = mapSample("everything");
    expect(shapesOf(mapped).ref("109")).toMatchObject({ w: 240, h: 150 });
    expect(shapesOf(mapped).ref("109").media).toBeUndefined();
    expect(section(mapped, "missing")).toContain("Image @109 named 1789031280088-gone.png, which is not in the project folder. It is empty now.");
  });

  it("fall back to a data URL when the named file is missing, without reporting it", () => {
    const mapped = mapNodes([image("100", { data: { file: "gone.png", fileName: "sketch.png", dataUrl: PNG_64x40 } })]);
    expect(shapesOf(mapped).ref("100").media).toMatchObject({ file: "legacy-5c59251f1b05f008-sketch.png" });
    expect(section(mapped, "missing")).toEqual([]);
  });

  it("keep their width, and take the aspect from data, then the file, then 1", () => {
    const mapped = mapNodes(
      [
        image("100", { width: 300, data: { file: "a.png", fileName: "a.png", aspect: 2 } }),
        image("101", { width: 300, data: { file: "b.png", fileName: "b.png" } }),
        image("102", { width: 300, data: { file: "c.png", fileName: "c.png" } }),
      ],
      [],
      { files: ["a.png", "b.png", "c.png"], imageSizes: { "a.png": { w: 10, h: 10 }, "b.png": { w: 30, h: 10 } } },
    );
    const { ref } = shapesOf(mapped);
    expect([ref("100").h, ref("101").h, ref("102").h]).toEqual([150, 100, 300]);
  });

  it("become image shapes over an asset whose source is a project file marker", () => {
    const mapped = mapSample("everything");
    const records = legacyRecords(mapped.canvas.shapes, ids);
    const shape = records.shapes.find((record) => record.meta.ref === "152")!;
    expect(shape).toMatchObject({ type: "image", props: { w: 240, h: 150, assetId: "asset:node:152", crop: null }, meta: { ref: "152" } });
    expect(records.assets.find((asset) => asset.id === "asset:node:152")).toMatchObject({
      type: "image",
      props: { src: "project-file:1789030980033-sea.png", name: "sea.png", w: 64, h: 40, mimeType: "image/png", isAnimated: false },
    });
    expect(records.shapes.find((record) => record.meta.ref === "108")!.props.assetId).toBeNull();
  });
});

describe("videos", () => {
  it("name their file, with the aspect from data", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("110")).toMatchObject({ kind: "video", w: 240, media: { kind: "file", file: "1789031160066-waves.mp4", mime: "video/mp4" } });
    expect(ref("110").h).toBeCloseTo(135, 1);
  });

  it("turn an https link into a linked reference clip, at 16:9 when data has no aspect", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("111")).toMatchObject({ kind: "video", w: 240, h: 135, media: { kind: "link", url: "https://media.example.com/clips/fox-trot.mp4?v=2", name: "fox-trot.mp4" } });
    const records = legacyRecords(mapSample("everything").canvas.shapes, ids);
    expect(records.assets.find((asset) => asset.id === "asset:node:111")).toMatchObject({ type: "video", props: { src: "https://media.example.com/clips/fox-trot.mp4?v=2", mimeType: null, isAnimated: true } });
  });

  it("extract a data URL, and are empty otherwise, falling back to 16:9", () => {
    const clip = "data:video/mp4;base64,AAAAIGZ0eXBpc29t";
    const mapped = mapNodes([
      { id: "110", type: "video", ...at(0, 0), width: 240, data: { fileName: "clip.mp4", dataUrl: clip } },
      { id: "111", type: "video", ...at(0, 300), width: 240, data: { fileName: "" } },
      { id: "112", type: "video", ...at(0, 600), width: 240, data: { file: "gone.mp4", fileName: "gone.mp4" } },
    ]);
    const { ref } = shapesOf(mapped);
    expect(ref("110")).toMatchObject({ h: 135, media: { kind: "file", mime: "video/mp4" } });
    expect((ref("110").media as { file: string }).file).toMatch(/^legacy-[0-9a-f]{16}-clip\.mp4$/);
    expect(ref("111")).toMatchObject({ h: 135 });
    expect(ref("111").media).toBeUndefined();
    expect(section(mapped, "missing")).toEqual(["Video @112 named gone.mp4, which is not in the project folder. It is empty now."]);
  });
});

describe("groups", () => {
  it("keep their @id, bounds and members, members relative to them; data.name is ignored", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("character")).toMatchObject({ kind: "group", x: 0, y: 3200, w: 420, h: 300 });
    expect(ref("120")).toMatchObject({ parent: "node:character", x: 28, y: 56 });
    expect(ref("121")).toMatchObject({ parent: "node:character", x: 28, y: 130, w: 160, h: 100 });
    expect(shapesOf(mapSample("everything")).list.some((shape) => shape.ref === "Hiker" || shape.ref === "hero")).toBe(false);
  });

  it("take 420 by 280 with no size, and become frames named by their @id with members parented to them", () => {
    const mapped = mapNodes([group("box", { width: undefined, height: undefined, ...at(10, 20) }), prompt("120", "inside", { parentId: "box", ...at(28, 56) })]);
    expect(shapesOf(mapped).ref("box")).toMatchObject({ x: 10, y: 20, w: 420, h: 280 });
    const records = legacyRecords(mapped.canvas.shapes, ids).shapes;
    expect(records[0]).toMatchObject({ id: "shape:node:box", type: "frame", props: { name: "box", w: 420, h: 280 }, meta: {} });
    expect(records[1]).toMatchObject({ parentId: "shape:node:box", x: 28, y: 56, index: "a1" });
  });
});

describe("pages and motions", () => {
  it("keep their file, title, fileName, dial values and size", () => {
    const { ref } = shapesOf(mapSample("everything"));
    expect(ref("200")).toMatchObject({
      kind: "page",
      x: 1700,
      y: 0,
      w: 480,
      h: 320,
      artifact: { file: "1789035000101-fox-landing.html", title: "Fox landing", fileName: "", dials: { headline: "The fox at dusk", accent: "#7c3aed" } },
    });
    expect(ref("201")).toMatchObject({ kind: "motion", w: 480, h: 300, artifact: { file: "1789035300202-cliff-intro.html", title: "Cliff intro", fileName: "" } });
    expect(ref("201").artifact).not.toHaveProperty("dials");
  });

  it("show the empty state when their file is missing, and the report says so", () => {
    const mapped = mapNodes([
      { id: "200", type: "page", ...at(0, 0), data: { file: "gone.html", title: "Gone", fileName: "gone.html" } },
      { id: "201", type: "motion", ...at(0, 400), data: { file: "", title: "", fileName: "" } },
    ]);
    const { ref } = shapesOf(mapped);
    expect(ref("200")).toMatchObject({ w: 480, h: 320, artifact: { file: "", title: "Gone", fileName: "gone.html" } });
    expect(ref("201")).toMatchObject({ w: 480, h: 300, artifact: { file: "" } });
    expect(section(mapped, "missing")).toEqual(["Page @200 named gone.html, which is not in the project folder. It is empty now."]);
  });

  it("become page and motion shapes with their props", () => {
    const records = legacyRecords(mapSample("everything").canvas.shapes, ids).shapes;
    expect(records.find((record) => record.meta.ref === "200")).toMatchObject({
      type: "page",
      props: { w: 480, h: 320, file: "1789035000101-fox-landing.html", title: "Fox landing", fileName: "", dials: { headline: "The fox at dusk", accent: "#7c3aed" } },
      meta: { ref: "200" },
    });
  });
});
