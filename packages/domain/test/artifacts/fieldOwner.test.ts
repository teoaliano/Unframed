import { describe, expect, it } from "vitest";
import { fieldOwner, type FieldOwnerInput } from "../../src/index.ts";

/** A stub normaliser: colours and lengths compare as their lowercase form, with a unit-less zero read as 0px. */
const normalise = (value: string) => value.trim().toLowerCase().replace(/^#([0-9a-f]{3})$/, (_, h: string) => "#" + [...h].map((c) => c + c).join(""));

const base = (over: Partial<FieldOwnerInput> = {}): FieldOwnerInput => ({
  field: { kind: "style", property: "color" },
  source: { inline: { color: "#a78bfa" }, text: "Hello", src: "a.png" },
  live: { inline: { color: "#A78BFA" }, text: "Hello", src: "a.png", animated: [] },
  dials: {},
  locked: false,
  normalise,
  ...over,
});

describe("fieldOwner", () => {
  it("answers locked first, even for a runtime element or an animated one", () => {
    expect(fieldOwner(base({ locked: true, source: null }))).toEqual({ owner: "locked" });
    expect(fieldOwner(base({ locked: true, live: { inline: {}, text: null, src: null, animated: ["color"] } }))).toEqual({ owner: "locked" });
  });

  it("answers script for a runtime element, which has no id in the source", () => {
    expect(fieldOwner(base({ source: null }))).toEqual({ owner: "script" });
  });

  it("answers animated for a property a motion animates on the element, before any comparison", () => {
    expect(fieldOwner(base({ live: { inline: { color: "#000" }, text: null, src: null, animated: ["color"] } }))).toEqual({ owner: "animated" });
  });

  it("answers source when the live inline value equals the source's, under the caller's normalise, or when both are absent", () => {
    expect(fieldOwner(base())).toEqual({ owner: "source" });
    expect(fieldOwner(base({ source: { inline: {}, text: null, src: null }, live: { inline: { color: null }, text: null, src: null, animated: [] } }))).toEqual({ owner: "source" });
  });

  it("answers the dial whose value the live value shows, with a unit appended or as a colour", () => {
    const withColour = base({ source: { inline: { color: "#000" }, text: null, src: null }, live: { inline: { color: "#a78bfa" }, text: null, src: null, animated: [] } });
    expect(fieldOwner({ ...withColour, dials: { scene: { accent: "#A78BFA" } } })).toEqual({ owner: "dial", path: "scene.accent" });

    const sized = base({ field: { kind: "style", property: "font-size" }, source: { inline: { "font-size": "10px" }, text: null, src: null }, live: { inline: { "font-size": "24px" }, text: null, src: null, animated: [] } });
    expect(fieldOwner({ ...sized, dials: { size: 24 } })).toEqual({ owner: "dial", path: "size" });
  });

  it("answers script when two dials hold the same value, and when no dial does", () => {
    const sized = base({ field: { kind: "style", property: "font-size" }, source: { inline: { "font-size": "10px" }, text: null, src: null }, live: { inline: { "font-size": "24px" }, text: null, src: null, animated: [] } });
    expect(fieldOwner({ ...sized, dials: { a: 24, b: 24 } })).toEqual({ owner: "script" });
    expect(fieldOwner({ ...sized, dials: { a: 12 } })).toEqual({ owner: "script" });
  });

  it("answers script when the live value differs and no dial sets it (the agent's code computed it)", () => {
    expect(fieldOwner(base({ live: { inline: { color: "#123456" }, text: "Hello", src: "a.png", animated: [] } }))).toEqual({ owner: "script" });
    expect(fieldOwner(base({ live: { inline: { color: null }, text: "Hello", src: "a.png", animated: [] } }))).toEqual({ owner: "script" });
  });

  it("compares text with whitespace collapsed, and falls back to a text dial", () => {
    const text: FieldOwnerInput["field"] = { kind: "text" };
    expect(fieldOwner(base({ field: text, live: { inline: {}, text: "Hello   there\n", src: null, animated: [] }, source: { inline: {}, text: "Hello there", src: null } }))).toEqual({ owner: "source" });
    expect(fieldOwner(base({ field: text, live: { inline: {}, text: "Set by code", src: null, animated: [] }, source: { inline: {}, text: "Hello", src: null }, dials: { label: "Set by code" } }))).toEqual({ owner: "dial", path: "label" });
    expect(fieldOwner(base({ field: text, live: { inline: {}, text: "Set by code", src: null, animated: [] }, source: { inline: {}, text: "Hello", src: null }, dials: {} }))).toEqual({ owner: "script" });
  });

  it("compares an image's src with the source attribute, then a dial with the same path", () => {
    const src: FieldOwnerInput["field"] = { kind: "src" };
    expect(fieldOwner(base({ field: src, live: { inline: {}, text: null, src: "a.png", animated: [] }, source: { inline: {}, text: null, src: "a.png" } }))).toEqual({ owner: "source" });
    expect(fieldOwner(base({ field: src, live: { inline: {}, text: null, src: "b.png", animated: [] }, source: { inline: {}, text: null, src: "a.png" }, dials: { pic: "b.png" } }))).toEqual({ owner: "dial", path: "pic" });
    expect(fieldOwner(base({ field: src, live: { inline: {}, text: null, src: "c.png", animated: [] }, source: { inline: {}, text: null, src: "a.png" } }))).toEqual({ owner: "script" });
  });
});
