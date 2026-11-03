import { describe, expect, it } from "vitest";
import { mergeKit, replaceKit } from "../../src/kits/merge.ts";
import type { Kit, Token } from "../../src/kits/types.ts";

const tok = (path: string, value: string, extra: Partial<Token> = {}): Token => ({ path, type: "color", value, ...extra });
const kit = (tokens: Token[], modes = ["light"], name = "Brand"): Kit => ({ format: 1, name, modes, tokens });
const base = (tokens: Token[], modes = ["light"]) => ({ modes, tokens });

const merge = (project: Kit, b: { modes: string[]; tokens: Token[] }, library: Kit, choices?: Record<string, "mine" | "kit">) =>
  mergeKit({ project, base: b, library }, choices);

describe("the merge table, per token path", () => {
  it("takes the library's value when only the library changed", () => {
    const r = merge(kit([tok("c/a", "#000")]), base([tok("c/a", "#000")]), kit([tok("c/a", "#222")]));
    expect(r.kit.tokens).toEqual([tok("c/a", "#222")]);
    expect(r.counts).toEqual({ updated: 1, added: 0, kept: 0, removed: 0 });
    expect(r.conflicts).toEqual([]);
  });

  it("keeps the project's value when only the project changed", () => {
    const r = merge(kit([tok("c/a", "#111")]), base([tok("c/a", "#000")]), kit([tok("c/a", "#000")]));
    expect(r.kit.tokens).toEqual([tok("c/a", "#111")]);
    expect(r.counts).toEqual({ updated: 0, added: 0, kept: 1, removed: 0 });
  });

  it("takes the shared value when both changed to the same value", () => {
    const r = merge(kit([tok("c/a", "#111")]), base([tok("c/a", "#000")]), kit([tok("c/a", "#111")]));
    expect(r.kit.tokens).toEqual([tok("c/a", "#111")]);
    expect(r.conflicts).toEqual([]);
  });

  it("reports a conflict when both changed differently, keeping the project's value by default", () => {
    const r = merge(kit([tok("c/a", "#111")]), base([tok("c/a", "#000")]), kit([tok("c/a", "#222")]));
    expect(r.kit.tokens).toEqual([tok("c/a", "#111")]);
    expect(r.conflicts).toEqual([{ path: "c/a", mode: "light", here: "#111", kit: "#222" }]);
  });

  it("takes the library's value for a conflict the person chose to take", () => {
    const r = merge(kit([tok("c/a", "#111")]), base([tok("c/a", "#000")]), kit([tok("c/a", "#222")]), { "c/a|light": "kit" });
    expect(r.kit.tokens).toEqual([tok("c/a", "#222")]);
    expect(r.conflicts).toEqual([{ path: "c/a", mode: "light", here: "#111", kit: "#222" }]);
  });

  it("keeps a token the project added, and counts it as kept", () => {
    const r = merge(kit([tok("c/mine", "#111")]), base([]), kit([]));
    expect(r.kit.tokens).toEqual([tok("c/mine", "#111")]);
    expect(r.counts.kept).toBe(1);
  });

  it("adds a token the library added, and counts it", () => {
    const r = merge(kit([]), base([]), kit([tok("c/new", "#222")]));
    expect(r.kit.tokens).toEqual([tok("c/new", "#222")]);
    expect(r.counts.added).toBe(1);
  });

  it("treats a path both sides added as a change on each: the same value is taken, different is a conflict", () => {
    expect(merge(kit([tok("c/x", "#111")]), base([]), kit([tok("c/x", "#111")])).conflicts).toEqual([]);
    const different = merge(kit([tok("c/x", "#111")]), base([]), kit([tok("c/x", "#222")]));
    expect(different.kit.tokens).toEqual([tok("c/x", "#111")]);
    expect(different.conflicts).toEqual([{ path: "c/x", mode: "light", here: "#111", kit: "#222" }]);
  });

  it("keeps a token the project deleted when the library left it unchanged", () => {
    const r = merge(kit([]), base([tok("c/a", "#000")]), kit([tok("c/a", "#000")]));
    expect(r.kit.tokens).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });

  it("reports a conflict when the project deleted a token the library changed", () => {
    const r = merge(kit([]), base([tok("c/a", "#000")]), kit([tok("c/a", "#222")]));
    expect(r.kit.tokens).toEqual([]);
    expect(r.conflicts).toEqual([{ path: "c/a", mode: "light", here: "(deleted)", kit: "#222" }]);
  });

  it("keeps a token the library deleted, as a project token, and counts it as no longer in the kit", () => {
    const r = merge(kit([tok("c/a", "#111")]), base([tok("c/a", "#000")]), kit([]));
    expect(r.kit.tokens).toEqual([tok("c/a", "#111")]);
    expect(r.counts.removed).toBe(1);
  });

  it("counts updated, added, kept and no-longer-in-the-kit across the kit", () => {
    const project = kit([tok("c/keep", "#111"), tok("c/take", "#000"), tok("c/mine", "#999")]);
    const b = base([tok("c/keep", "#000"), tok("c/take", "#000"), tok("c/gone", "#000")]);
    const library = kit([tok("c/keep", "#000"), tok("c/take", "#333"), tok("c/gone", "#000"), tok("c/add", "#444")]);
    const r = merge(project, b, library);
    expect(r.counts).toEqual({ updated: 1, added: 1, kept: 2, removed: 0 });
  });
});

describe("modes", () => {
  it("adds a library mode the project lacks", () => {
    const r = merge(kit([tok("c/a", "#111")], ["light"]), base([tok("c/a", "#111")], ["light"]), kit([tok("c/a", "#111")], ["light", "dark"]));
    expect(r.kit.modes).toEqual(["light", "dark"]);
  });

  it("keeps a mode only the project has", () => {
    const r = merge(kit([tok("c/a", "#111")], ["light", "mine"]), base([tok("c/a", "#111")], ["light"]), kit([tok("c/a", "#111")], ["light"]));
    expect(r.kit.modes).toEqual(["light", "mine"]);
  });

  it("keeps a mode the library deleted", () => {
    const r = merge(kit([tok("c/a", "#111")], ["light", "dark"]), base([tok("c/a", "#111")], ["light", "dark"]), kit([tok("c/a", "#111")], ["light"]));
    expect(r.kit.modes).toEqual(["light", "dark"]);
  });

  it("merges a per-mode value in each mode separately", () => {
    const b = base([{ path: "c/a", type: "color", values: { light: "#000", dark: "#000" } }], ["light", "dark"]);
    const project = kit([{ path: "c/a", type: "color", values: { light: "#111", dark: "#000" } }], ["light", "dark"]);
    const library = kit([{ path: "c/a", type: "color", values: { light: "#000", dark: "#222" } }], ["light", "dark"]);
    const r = merge(project, b, library);
    expect(r.kit.tokens[0]).toEqual({ path: "c/a", type: "color", values: { light: "#111", dark: "#222" } });
    expect(r.counts).toEqual({ updated: 1, added: 0, kept: 0, removed: 0 });
  });

  it("reads a mode a token leaves out as the default mode's value", () => {
    const b = base([{ path: "c/a", type: "color", values: { light: "#000" } }], ["light", "dark"]);
    const project = kit([{ path: "c/a", type: "color", values: { light: "#000" } }], ["light", "dark"]);
    const library = kit([{ path: "c/a", type: "color", values: { light: "#000", dark: "#000" } }], ["light", "dark"]);
    const r = merge(project, b, library);
    expect(r.kit.tokens[0]).toEqual({ path: "c/a", type: "color", value: "#000" });
    expect(r.conflicts).toEqual([]);
  });
});

describe("renamed tokens and follow-along fields", () => {
  it("reads a rename in the library as one deleted and one added, keeping the old one", () => {
    const b = base([tok("c/old", "#111")]);
    const library = kit([tok("c/new", "#111")]);
    const r = merge(kit([tok("c/old", "#111")]), b, library);
    expect(r.kit.tokens.map((t) => t.path)).toEqual(["c/old", "c/new"]);
    expect(r.counts.added).toBe(1);
    expect(r.counts.removed).toBe(1);
  });

  it("takes the library's description and type when the library's value wins", () => {
    const b = base([tok("c/a", "#000")]);
    const library = kit([{ path: "c/a", type: "color", value: "#222", description: "brand" }]);
    const r = merge(kit([tok("c/a", "#000")]), b, library);
    expect(r.kit.tokens[0]!.description).toBe("brand");
  });

  it("keeps the project's former names", () => {
    const r = merge(kit([tok("c/a", "#111", { formerNames: ["--c-old"] })]), base([tok("c/a", "#000")]), kit([tok("c/a", "#222")]), { "c/a|light": "kit" });
    expect(r.kit.tokens[0]!.formerNames).toEqual(["--c-old"]);
  });

  it("keeps the project's name, modes and from", () => {
    const project: Kit = { ...kit([tok("c/a", "#111")], ["light"], "Mine"), from: { presetId: "p", revision: 1, base: base([]) } };
    const r = merge(project, base([tok("c/a", "#111")]), kit([tok("c/a", "#111")], ["light"], "Theirs"));
    expect(r.kit.name).toBe("Mine");
    expect(r.kit.from).toEqual(project.from);
  });
});

describe("replaceKit", () => {
  it("keeps the project's modes, adds the library's, takes its name, sets its tokens and keeps the others", () => {
    const project = kit([tok("c/a", "#111"), tok("c/mine", "#999")], ["light"], "Old");
    const library = kit([tok("c/a", "#222"), tok("c/b", "#333")], ["light", "dark"], "New");
    const r = replaceKit(project, library);
    expect(r.name).toBe("New");
    expect(r.modes).toEqual(["light", "dark"]);
    expect(r.tokens).toEqual([tok("c/a", "#222"), tok("c/mine", "#999"), tok("c/b", "#333")]);
    expect(r.from).toBeUndefined();
  });

  it("starts from the project's default mode and keeps its order", () => {
    const r = replaceKit(kit([], ["mine"], "Old"), kit([], ["light", "mine"], "New"));
    expect(r.modes).toEqual(["mine", "light"]);
  });
});
