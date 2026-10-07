import { describe, expect, it } from "vitest";
import { mentionCandidates, mentionQuery } from "../src/index.ts";

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const prompt = (ref: string, text: string) => ({ typeName: "shape", type: "text", props: { richText: doc(text) }, meta: { ref } });
const group = (name: string) => ({ typeName: "shape", type: "frame", props: { name }, meta: {} });
const image = (ref: string) => ({ typeName: "shape", type: "image", props: {}, meta: { ref } });
const video = (ref: string) => ({ typeName: "shape", type: "video", props: {}, meta: { ref } });
const page = (ref: string, title = "") => ({ typeName: "shape", type: "page", props: { title, fileName: "" }, meta: { ref } });
const motion = (ref: string, fileName = "") => ({ typeName: "shape", type: "motion", props: { title: "", fileName }, meta: { ref } });

describe("mentionQuery", () => {
  it("is empty right after an @", () => {
    expect(mentionQuery("A fox on @")).toBe("");
  });

  it("is the word characters and hyphens typed after the @", () => {
    expect(mentionQuery("A fox on @10")).toBe("10");
    expect(mentionQuery("@hero-sh")).toBe("hero-sh");
    expect(mentionQuery("see @my_gr")).toBe("my_gr");
  });

  it("is undefined when the text before the caret does not end in an @ query", () => {
    expect(mentionQuery("A fox")).toBeUndefined();
    expect(mentionQuery("@100 ")).toBeUndefined();
    expect(mentionQuery("@10.")).toBeUndefined();
    expect(mentionQuery("")).toBeUndefined();
  });

  it("looks only at the last token", () => {
    expect(mentionQuery("@100 and @")).toBe("");
  });
});

describe("mentionCandidates", () => {
  const board = [
    prompt("100", "lone red fox"),
    prompt("101", "A   @100 on a windswept\n\ncliff at golden hour, cinematic"),
    group("Hero-shots"),
    image("104"),
    prompt("110", "night"),
    { typeName: "shape", type: "geo", props: {}, meta: {} },
  ];

  it("lists every shape with a ref but this prompt and the marks, with a prompt's text, an artifact's title or the kind as the preview", () => {
    expect(mentionCandidates(board, "101", "")).toEqual([
      { ref: "100", preview: "lone red fox" },
      { ref: "104", preview: "Image" },
      { ref: "110", preview: "night" },
      { ref: "Hero-shots" },
    ]);
    expect(mentionCandidates([video("waves"), page("landing", "Landing page"), page("pricing"), motion("intro", "intro.html")], undefined, "")).toEqual([
      { ref: "intro", preview: "intro" },
      { ref: "landing", preview: "Landing page" },
      { ref: "pricing", preview: "Page" },
      { ref: "waves", preview: "Video" },
    ]);
  });

  it("keeps the refs that start with the query, compared case-insensitively", () => {
    expect(mentionCandidates(board, "100", "10").map((row) => row.ref)).toEqual(["101", "104"]);
    expect(mentionCandidates(board, "100", "hero").map((row) => row.ref)).toEqual(["Hero-shots"]);
    expect(mentionCandidates(board, "100", "HERO-S").map((row) => row.ref)).toEqual(["Hero-shots"]);
    expect(mentionCandidates(board, "100", "2")).toEqual([]);
  });

  it("collapses whitespace runs to one space and cuts the preview at 24 characters", () => {
    const [row] = mentionCandidates(board, "100", "101");
    expect(row).toEqual({ ref: "101", preview: "A @100 on a windswept cl…" });
    expect(row!.preview!.replace("…", "")).toHaveLength(24);
  });

  it("trims the preview and keeps a text of exactly 24 characters whole", () => {
    const [row] = mentionCandidates([prompt("120", "  abcdefghijklmnopqrstuvwx  ")], "100", "");
    expect(row).toEqual({ ref: "120", preview: "abcdefghijklmnopqrstuvwx" });
  });

  it("orders numbered refs by number, then names alphabetically", () => {
    const refs = mentionCandidates([group("zeta"), prompt("1000", ""), group("alpha"), prompt("200", "")], undefined, "");
    expect(refs.map((row) => row.ref)).toEqual(["200", "1000", "alpha", "zeta"]);
  });
});
