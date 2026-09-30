import { describe, expect, it } from "vitest";
import { changeLibrary, LIBRARY_PAGE_SIZE, libraryRange, libraryView, type LibraryControls, type PresetSummary } from "../src/index.ts";

const user = (id: string, name: string, savedAt: string | undefined, extra: Partial<PresetSummary> = {}): PresetSummary => ({
  id,
  source: "user",
  name,
  summary: "",
  kind: "group",
  ...(savedAt === undefined ? {} : { savedAt }),
  ...extra,
});
const system = (id: string, name: string, extra: Partial<PresetSummary> = {}): PresetSummary => ({ id, source: "system", name, summary: "", kind: "recipe", medium: "text", ...extra });

const controls = (patch: Partial<LibraryControls> = {}): LibraryControls => ({ query: "", type: "all", source: "any", sort: "newest", page: 1, ...patch });
const ids = (presets: ReadonlyArray<PresetSummary>, patch: Partial<LibraryControls> = {}) => libraryView(presets, controls(patch)).items.map((preset) => preset.id);

const presets = [
  user("u-new", "Portrait retouch", "2026-09-20T10:00:00.000Z", { kind: "recipe", medium: "image", summary: "Soft light for faces" }),
  user("u-old", "Beach set", "2026-01-02T10:00:00.000Z"),
  user("u-undated", "zebra", undefined),
  user("u-mid", "Character sheet", "2026-05-05T10:00:00.000Z", { kind: "recipe", medium: "video" }),
  system("layerize", "Layerize", { summary: "Split an image into its parts" }),
  system("to-json", "Prose to JSON"),
];

describe("libraryView filters", () => {
  it.each<[string, Partial<LibraryControls>, string[]]>([
    ["everything, newest first", {}, ["u-new", "u-mid", "u-old", "u-undated", "layerize", "to-json"]],
    ["recipes only", { type: "recipe" }, ["u-new", "u-mid", "layerize", "to-json"]],
    ["groups only", { type: "group" }, ["u-old", "u-undated"]],
    ["custom only", { source: "user" }, ["u-new", "u-mid", "u-old", "u-undated"]],
    ["system only", { source: "system" }, ["layerize", "to-json"]],
    ["the query matches the name, case-insensitively", { query: "  BEACH " }, ["u-old"]],
    ["the query matches the summary", { query: "soft light" }, ["u-new"]],
    ["the query matches across name and summary with one space", { query: "layerize split" }, ["layerize"]],
    ["filters combine", { type: "recipe", source: "user", query: "character" }, ["u-mid"]],
    ["nothing matches", { query: "nothing like this" }, []],
  ])("%s", (_case, patch, expected) => {
    expect(ids(presets, patch)).toEqual(expected);
  });
});

describe("libraryView sorts", () => {
  it("newest: dated presets by time, then user presets without a time, then system presets", () => {
    expect(ids(presets, { sort: "newest" })).toEqual(["u-new", "u-mid", "u-old", "u-undated", "layerize", "to-json"]);
  });

  it("oldest is the exact reverse of newest", () => {
    expect(ids(presets, { sort: "oldest" })).toEqual(["to-json", "layerize", "u-undated", "u-old", "u-mid", "u-new"]);
  });

  it("A–Z compares names by locale, Z–A is its reverse", () => {
    expect(ids(presets, { sort: "az" })).toEqual(["u-old", "u-mid", "layerize", "u-new", "to-json", "u-undated"]);
    expect(ids(presets, { sort: "za" })).toEqual(["u-undated", "to-json", "u-new", "layerize", "u-mid", "u-old"]);
  });

  it("is stable: equal ranks keep the order of the list", () => {
    const twins = [user("a", "Same", undefined), user("b", "Same", undefined), user("c", "Same", undefined)];
    expect(ids(twins, { sort: "newest" })).toEqual(["a", "b", "c"]);
    expect(ids(twins, { sort: "az" })).toEqual(["a", "b", "c"]);
  });
});

describe("libraryView pages", () => {
  const many = Array.from({ length: 23 }, (_, index) => user(`u-${index}`, `Preset ${String(index).padStart(2, "0")}`, new Date(Date.UTC(2026, 0, 1 + index)).toISOString()));

  it("cuts pages of 10 after sorting", () => {
    expect(LIBRARY_PAGE_SIZE).toBe(10);
    const first = libraryView(many, controls({ sort: "oldest", page: 1 }));
    expect(first.items.map((preset) => preset.id)).toEqual(Array.from({ length: 10 }, (_, index) => `u-${index}`));
    expect(first).toMatchObject({ page: 1, pages: 3, total: 23 });
    const last = libraryView(many, controls({ sort: "newest", page: 3 }));
    expect(last.items.map((preset) => preset.id)).toEqual(["u-2", "u-1", "u-0"]);
  });

  it("clamps the page to the last one, and to 1 when nothing matches", () => {
    expect(libraryView(many, controls({ page: 9 })).page).toBe(3);
    expect(libraryView(many, controls({ page: 0 })).page).toBe(1);
    expect(libraryView(many, controls({ page: 3, query: "zzz" }))).toMatchObject({ page: 1, pages: 1, total: 0, items: [] });
  });

  it("names the range shown", () => {
    expect(libraryRange(libraryView(many, controls({ page: 2 })))).toBe("11–20 of 23");
    expect(libraryRange(libraryView(many, controls({ page: 3 })))).toBe("21–23 of 23");
  });
});

describe("changeLibrary", () => {
  it.each<[string, Partial<LibraryControls>]>([
    ["the query", { query: "fox" }],
    ["the type", { type: "recipe" }],
    ["the source", { source: "system" }],
    ["the sort", { sort: "az" }],
  ])("a change of %s goes back to page 1", (_case, patch) => {
    expect(changeLibrary(controls({ page: 3 }), patch).page).toBe(1);
  });

  it("a page change is kept, and a change to the same value keeps the page", () => {
    expect(changeLibrary(controls({ page: 1 }), { page: 2 }).page).toBe(2);
    expect(changeLibrary(controls({ page: 2, sort: "az" }), { sort: "az" }).page).toBe(2);
  });
});
