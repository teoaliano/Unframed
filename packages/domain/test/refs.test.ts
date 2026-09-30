import { describe, expect, it } from "vitest";
import { nextRef, plainText, readRef, refTokens, slug } from "../src/index.ts";

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: text === "" ? [] : [{ type: "text", text }] })),
});

const prompt = (ref: string, ...paragraphs: string[]) => ({
  typeName: "shape",
  type: "text",
  props: { richText: doc(...paragraphs) },
  meta: { ref },
});
const image = (ref: string) => ({ typeName: "shape", type: "image", props: { assetId: null }, meta: { ref } });
const group = (name: string) => ({ typeName: "shape", type: "frame", props: { name }, meta: {} });
const mark = { typeName: "shape", type: "geo", props: {}, meta: {} };

describe("the @ token pattern", () => {
  it("finds @ followed by word characters and hyphens", () => {
    expect(refTokens("A @100 on @fox-den, and @my_group.")).toEqual(["100", "fox-den", "my_group"]);
  });

  it("finds nothing in a bare @ or in text without one", () => {
    expect(refTokens("mail me @ home")).toEqual([]);
    expect(refTokens("no references")).toEqual([]);
  });
});

describe("plain text of a prompt", () => {
  it("joins paragraphs with a line break", () => {
    expect(plainText(doc("first", "", "third"))).toBe("first\n\nthird");
  });

  it("turns a hard break into a line break and keeps inline text together", () => {
    const richText = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "a " }, { type: "text", text: "bold", marks: [{ type: "bold" }] }, { type: "hardBreak" }, { type: "text", text: "b" }],
        },
      ],
    };
    expect(plainText(richText)).toBe("a bold\nb");
  });
});

describe("reading a ref", () => {
  it("reads meta.ref from prompts, media, pages and motions, and the name of a group", () => {
    expect(readRef(prompt("100"))).toBe("100");
    expect(readRef(image("104"))).toBe("104");
    expect(readRef({ typeName: "shape", type: "page", props: {}, meta: { ref: "105" } })).toBe("105");
    expect(readRef({ typeName: "shape", type: "motion", props: {}, meta: { ref: "106" } })).toBe("106");
    expect(readRef(group("hero-shots"))).toBe("hero-shots");
  });

  it("gives marks no ref, and ignores a stray meta.ref on a group", () => {
    expect(readRef(mark)).toBeUndefined();
    expect(readRef({ typeName: "shape", type: "frame", props: { name: "120" }, meta: { ref: "999" } })).toBe("120");
  });
});

describe("nextRef", () => {
  it("gives 100 on an empty canvas", () => {
    expect(nextRef([])).toBe("100");
    expect(nextRef([mark, { typeName: "page", id: "page:page" }])).toBe("100");
  });

  it("is one more than the largest numeric ref", () => {
    expect(nextRef([prompt("100", "x"), image("104"), group("102")])).toBe("105");
  });

  it("counts a dangling token in a prompt, so a new shape never captures an old reference", () => {
    expect(nextRef([prompt("100", "A @110 on a cliff")])).toBe("111");
  });

  it("counts tokens in every paragraph of every prompt", () => {
    expect(nextRef([prompt("100", "first", "then @130"), prompt("101", "@120")])).toBe("131");
  });

  it("ignores named groups and tokens that are not whole numbers", () => {
    expect(nextRef([group("hero-shots"), prompt("100", "@fox and @200abc and @300-a")])).toBe("101");
  });

  it("never goes below 100, whatever small numbers are on the board", () => {
    expect(nextRef([prompt("7", "@42")])).toBe("100");
  });

  it("stays exact for numbers past the float range", () => {
    expect(nextRef([prompt("100", "@99999999999999999999")])).toBe("100000000000000000000");
  });

  it("does not count tokens in media or group names", () => {
    expect(nextRef([{ typeName: "shape", type: "image", props: {}, meta: { ref: "@500" } }])).toBe("100");
  });
});

describe("slug", () => {
  it("is spec 01's slug rule", () => {
    expect(slug("My Group!")).toBe("my-group");
  });
});
