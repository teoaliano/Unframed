import { describe, expect, it } from "vitest";
import {
  droppedWiresNote,
  flowFrom,
  flowInsert,
  linkedFiles,
  PAGE_FILES_REFUSAL,
  PAGE_REJECTED_MESSAGE,
  PAGE_SEND_REFUSAL,
  pageAnswer,
  pageSend,
  pageTitle,
  type ContentShape,
  type PresetContent,
} from "../../src/index.ts";

const shape = (id: string, type: string, props: Record<string, unknown> = {}, parentId = "page:page"): ContentShape => ({ id, typeName: "shape", type, parentId, x: 0, y: 0, props, meta: {} });

const content = (shapes: ContentShape[]): PresetContent => ({ schema: {}, shapes, rootShapeIds: ["shape:g"], assets: [] });

describe("flows", () => {
  const saved = content([
    shape("shape:g", "frame", { name: "flow" }),
    shape("shape:p", "text", {}, "shape:g"),
    shape("shape:n", "node", { medium: "image", model: "m", params: {}, instruction: "go", versions: [{ id: "v" }], currentVersionId: "v", run: { runId: "r" }, error: "x" }, "shape:g"),
    shape("shape:w-in", "wire", { from: "shape:p", to: "shape:n", role: "prompt" }, "shape:g"),
    shape("shape:w-out", "wire", { from: "shape:elsewhere", to: "shape:n", role: "reference" }, "shape:g"),
  ]);

  it("keeps the wires inside the set, counts the rest, and blanks the nodes", () => {
    const flow = flowFrom(saved);
    expect(flow.droppedWires).toBe(1);
    expect(flow.content.shapes.map((each) => each.id)).toEqual(["shape:g", "shape:p", "shape:n", "shape:w-in"]);
    expect(flow.content.shapes.find((each) => each.id === "shape:n")!.props).toEqual({ medium: "image", model: "m", params: {}, instruction: "go", versions: [], currentVersionId: null });
    expect(droppedWiresNote(flow.droppedWires)).toBe("Saved. 1 wire from outside the set was left out.");
    expect(droppedWiresNote(2)).toBe("Saved. 2 wires from outside the set were left out.");
    expect(droppedWiresNote(0)).toBeUndefined();
  });

  it("inserts with fresh ids, the wires rewired to them", () => {
    let n = 0;
    const inserted = flowInsert(flowFrom(saved).content, () => `shape:new${++n}`);
    const byOld = Object.fromEntries(saved.shapes.slice(0, 4).map((each, index) => [each.id, inserted.shapes[index]!]));
    expect(inserted.rootShapeIds).toEqual([byOld["shape:g"]!.id]);
    expect(byOld["shape:p"]!.parentId).toBe(byOld["shape:g"]!.id);
    expect(byOld["shape:w-in"]!.props).toMatchObject({ from: byOld["shape:p"]!.id, to: byOld["shape:n"]!.id });
    expect(byOld["shape:n"]!.props.versions).toEqual([]);
  });
});

describe("page answer", () => {
  const doc = "<!doctype html>\n<html><head><title>Hi &amp; bye</title></head><body>x</body></html>";
  it.each([
    ["a full document", doc, { ok: true, html: `${doc}\n` }],
    ["a fenced document", "```html\n" + doc + "\n```", { ok: true, html: `${doc}\n` }],
    ["a document with an html element only", "<html><body>x</body></html>", { ok: true, html: "<html><body>x</body></html>\n" }],
    ["a fragment", "<div>hello</div>", { ok: false, message: PAGE_REJECTED_MESSAGE }],
    ["an empty answer", "   ", { ok: false, message: PAGE_REJECTED_MESSAGE }],
    ["two documents", `${doc}\n${doc}`, { ok: false, message: PAGE_REJECTED_MESSAGE }],
  ])("%s", (_case, text, answer) => {
    expect(pageAnswer(text)).toEqual(answer);
  });

  it("reads the title", () => {
    expect(pageTitle(doc)).toBe("Hi & bye");
    expect(pageTitle("<html><body></body></html>")).toBeUndefined();
    expect(pageTitle("<title>  </title>")).toBeUndefined();
  });
});

describe("page inputs", () => {
  it.each([
    ["an explicit choice", { role: "both" as const, chosen: true, files: "linked" as const, model: "m" }, { html: true, picture: true, files: "linked" }],
    ["HTML alone", { role: "prompt" as const, chosen: true, files: "entry" as const, model: "m" }, { html: true, picture: false, files: "entry" }],
    ["no choice and no default", { role: "prompt" as const, chosen: false, files: "entry" as const, model: "m" }, { error: PAGE_SEND_REFUSAL }],
    ["no files choice and no default", { role: "reference" as const, chosen: true, model: "m" }, { error: PAGE_FILES_REFUSAL }],
  ])("pageSend: %s", (_case, input, answer) => {
    expect(pageSend(input)).toEqual(answer);
  });

  const files = new Map([
    ["style.css", 2000],
    ["second.html", 1000],
    ["logo.png", 5000],
    ["unframed-dials.js", 100],
  ]);

  it("finds href and src to project files, one level deep", () => {
    const html = `<link href="style.css"><a href="./second.html#top">2</a><img src='logo.png'><script src="unframed-dials.js"></script><a href="https://x.dev">x</a><img src="data:image/png;base64,AA">`;
    expect(linkedFiles(html, files)).toEqual({ files: ["style.css", "second.html", "logo.png"] });
  });

  it("refuses a link to a file that is not in the project", () => {
    expect(linkedFiles(`<img src="gone.png">`, files)).toEqual({ error: "This page links gone.png, which is not in the project folder." });
  });

  it("refuses over 8 files or 1 MB", () => {
    const many = new Map(Array.from({ length: 9 }, (_, index) => [`f${index}.css`, 10] as const));
    const html = [...many.keys()].map((name) => `<link href="${name}">`).join("");
    expect(linkedFiles(html, many)).toEqual({ error: "This page links 9 files, 1 KB in all. Linked pages send up to 8 files and 1 MB. Send the page alone, or trim its links." });
    expect(linkedFiles(`<img src="big.png">`, new Map([["big.png", 2_000_000]]))).toEqual({
      error: "This page links 1 files, 1954 KB in all. Linked pages send up to 8 files and 1 MB. Send the page alone, or trim its links.",
    });
  });
});
