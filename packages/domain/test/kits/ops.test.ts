import { describe, expect, it } from "vitest";
import { applyKitOps, type KitOp } from "../../src/kits/ops.ts";
import type { Kit } from "../../src/kits/types.ts";

const kit = (over: Partial<Kit> = {}): Kit => ({
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
    { path: "space/gap", type: "dimension", value: "8px" },
  ],
  ...over,
});

const run = (start: Kit | null, ops: KitOp[]) => applyKitOps(start, ops);

const ok = (start: Kit | null, ops: KitOp[]): Kit | null => {
  const result = run(start, ops);
  if (!result.ok) throw new Error(`expected ok, got ${result.refusal}`);
  return result.kit;
};

const refused = (start: Kit | null, ops: KitOp[]) => {
  const result = run(start, ops);
  if (result.ok) throw new Error("expected a refusal");
  return { op: result.op, refusal: result.refusal };
};

describe("create, rename and remove", () => {
  it("creates a kit with one default mode when none is given", () => {
    expect(ok(null, [{ op: "create", name: "Kit" }])).toEqual({ format: 1, name: "Kit", modes: ["default"], tokens: [] });
  });

  it("refuses a second kit and any other op on a project with no kit", () => {
    expect(refused(kit(), [{ op: "create", name: "Other" }])).toEqual({ op: 1, refusal: "This project already has a kit." });
    expect(refused(null, [{ op: "rename", name: "Other" }])).toEqual({ op: 1, refusal: "This project has no kit yet." });
  });

  it("renames the kit and removes it", () => {
    expect(ok(kit(), [{ op: "rename", name: "Studio" }])!.name).toBe("Studio");
    expect(ok(kit(), [{ op: "remove" }])).toBeNull();
  });

  it("refuses a name of 81 characters", () => {
    expect(refused(kit(), [{ op: "rename", name: "x".repeat(81) }]).refusal).toBe("A kit needs a name of 1 to 80 characters.");
  });
});

describe("setToken", () => {
  it("adds a token at the end, and replaces one in place", () => {
    const added = ok(kit(), [{ op: "setToken", path: "shadow/card", type: "shadow", value: "0 2px 8px rgba(0,0,0,0.2)" }]);
    expect(added!.tokens.map((t) => t.path)).toEqual(["color/brand/primary", "space/gap", "shadow/card"]);
    const replaced = ok(kit(), [{ op: "setToken", path: "space/gap", type: "dimension", value: "12px" }]);
    expect(replaced!.tokens[1]).toEqual({ path: "space/gap", type: "dimension", value: "12px" });
  });

  it("keeps former names when a token is set again", () => {
    const start = kit({ tokens: [{ path: "space/gap", type: "dimension", value: "8px", formerNames: ["--space-old"] }] });
    expect(ok(start, [{ op: "setToken", path: "space/gap", type: "dimension", value: "12px" }])!.tokens[0]!.formerNames).toEqual(["--space-old"]);
  });

  it("refuses an invalid value with its sentence, naming the op", () => {
    expect(refused(kit(), [{ op: "setToken", path: "space/x", type: "dimension", value: "big" }])).toEqual({
      op: 1,
      refusal: "big is not a size. Use a number with px, rem, em or %.",
    });
  });
});

describe("renameToken", () => {
  it("moves the token and keeps its old CSS name as a former name", () => {
    const renamed = ok(kit(), [{ op: "renameToken", path: "space/gap", to: "space/inline" }]);
    expect(renamed!.tokens[1]).toEqual({ path: "space/inline", type: "dimension", value: "8px", formerNames: ["--space-gap"] });
  });

  it("adds no former name when the CSS name stays the same", () => {
    const renamed = ok(kit(), [{ op: "renameToken", path: "color/brand/primary", to: "color/brand/primary" }]);
    expect(renamed!.tokens[0]!.formerNames).toBeUndefined();
  });

  it("refuses an unknown token and a name already in use", () => {
    expect(refused(kit(), [{ op: "renameToken", path: "nope", to: "x/y" }]).refusal).toBe("There is no token nope in the kit.");
    expect(refused(kit(), [{ op: "renameToken", path: "space/gap", to: "color/brand/primary" }]).refusal).toBe("There is already a token color/brand/primary.");
  });
});

describe("deleteToken and forgetFormerName", () => {
  it("deletes a token, and refuses one an alias still refers to", () => {
    expect(ok(kit(), [{ op: "deleteToken", path: "space/gap" }])!.tokens.map((t) => t.path)).toEqual(["color/brand/primary"]);
    const aliased = kit({ tokens: [...kit().tokens, { path: "space/card", type: "dimension", value: "{space/gap}" }] });
    expect(refused(aliased, [{ op: "deleteToken", path: "space/gap" }]).refusal).toBe("space/card refers to space/gap, which is not in the kit.");
    expect(refused(kit(), [{ op: "deleteToken", path: "nope" }]).refusal).toBe("There is no token nope in the kit.");
  });

  it("forgets one former name", () => {
    const start = kit({ tokens: [{ path: "space/inline", type: "dimension", value: "8px", formerNames: ["--space-gap", "--space-x"] }] });
    expect(ok(start, [{ op: "forgetFormerName", path: "space/inline", cssName: "--space-gap" }])!.tokens[0]!.formerNames).toEqual(["--space-x"]);
    expect(refused(start, [{ op: "forgetFormerName", path: "space/inline", cssName: "--nope" }]).refusal).toBe("There is no former name --nope on space/inline.");
  });
});

describe("modes", () => {
  it("adds an empty mode, or one copied from another", () => {
    const empty = ok(kit(), [{ op: "addMode", name: "contrast" }]);
    expect(empty!.modes).toEqual(["light", "dark", "contrast"]);
    expect(empty!.tokens[0]!.values).toEqual({ light: "#1a73e8", dark: "#8ab4f8" });
    const copied = ok(kit(), [{ op: "addMode", name: "contrast", copyFrom: "dark" }]);
    expect(copied!.tokens[0]!.values).toEqual({ light: "#1a73e8", dark: "#8ab4f8", contrast: "#8ab4f8" });
  });

  it("refuses a repeated mode, a bad name, and a copy from a mode the kit lacks", () => {
    expect(refused(kit(), [{ op: "addMode", name: "dark" }]).refusal).toBe("There is already a mode dark.");
    expect(refused(kit(), [{ op: "addMode", name: "Big Mode" }]).refusal).toBe("A mode name is a short word, like light or dark.");
    expect(refused(kit(), [{ op: "addMode", name: "x", copyFrom: "night" }]).refusal).toBe("There is no mode night in the kit.");
  });

  it("renames a mode and carries its values", () => {
    const renamed = ok(kit(), [{ op: "renameMode", name: "dark", to: "night" }]);
    expect(renamed!.modes).toEqual(["light", "night"]);
    expect(renamed!.tokens[0]!.values).toEqual({ light: "#1a73e8", night: "#8ab4f8" });
    expect(refused(kit(), [{ op: "renameMode", name: "dark", to: "light" }]).refusal).toBe("There is already a mode light.");
  });

  it("deletes a mode, and refuses the last one", () => {
    const deleted = ok(kit(), [{ op: "deleteMode", name: "dark" }]);
    expect(deleted!.modes).toEqual(["light"]);
    expect(deleted!.tokens[0]!.values).toEqual({ light: "#1a73e8" });
    expect(refused(kit({ modes: ["light"] }), [{ op: "deleteMode", name: "light" }]).refusal).toBe("A kit keeps at least one mode.");
    expect(refused(kit(), [{ op: "deleteMode", name: "night" }]).refusal).toBe("There is no mode night in the kit.");
  });

  it("makes a mode the default by moving it first", () => {
    expect(ok(kit(), [{ op: "setDefaultMode", name: "dark" }])!.modes).toEqual(["dark", "light"]);
  });
});

describe("reorder", () => {
  it("puts the listed tokens first, in the order given, and keeps the rest after them", () => {
    const start = kit({ tokens: [...kit().tokens, { path: "a/b", type: "color", value: "#fff" }] });
    expect(ok(start, [{ op: "reorder", paths: ["a/b", "color/brand/primary"] }])!.tokens.map((t) => t.path)).toEqual(["a/b", "color/brand/primary", "space/gap"]);
    expect(refused(start, [{ op: "reorder", paths: ["nope"] }]).refusal).toBe("There is no token nope in the kit.");
  });
});

describe("all or nothing", () => {
  it("returns the first refusal with its op number and writes nothing", () => {
    const start = kit();
    const result = run(start, [
      { op: "rename", name: "Studio" },
      { op: "setToken", path: "space/x", type: "dimension", value: "big" },
      { op: "deleteToken", path: "space/gap" },
    ]);
    expect(result).toEqual({ ok: false, op: 2, refusal: "big is not a size. Use a number with px, rem, em or %." });
    expect(start.name).toBe("Brand");
  });

  it("applies every op in order when each is fine", () => {
    const result = ok(kit(), [
      { op: "addMode", name: "contrast" },
      { op: "setToken", path: "space/gap", type: "dimension", value: "12px" },
      { op: "deleteToken", path: "color/brand/primary" },
    ]);
    expect(result!.tokens.map((t) => t.path)).toEqual(["space/gap"]);
    expect(result!.modes).toEqual(["light", "dark", "contrast"]);
  });

  it("refuses a kit that would pass the limits", () => {
    const tokens = Array.from({ length: 2000 }, (_, i) => ({ path: "t/" + i, type: "color" as const, value: "#fff" }));
    expect(refused(kit({ tokens }), [{ op: "setToken", path: "one/more", type: "color", value: "#000" }]).refusal).toBe("A kit holds at most 2000 tokens.");
    expect(refused(kit(), [{ op: "addMode", name: "m1" }, ...Array.from({ length: 11 }, (_, i) => ({ op: "addMode" as const, name: "m" + (i + 2) }))]).refusal).toBe(
      "A kit holds at most 12 modes.",
    );
  });
});

describe("addToken", () => {
  it("adds a token that has no path yet", () => {
    const next = ok(kit(), [{ op: "addToken", path: "color/accent", type: "color", value: "#000000" }]);
    expect(next?.tokens.map((token) => token.path)).toEqual(["color/brand/primary", "space/gap", "color/accent"]);
  });

  it("refuses a path that a token already has, with the sentence Rename uses, and writes nothing", () => {
    expect(refused(kit(), [{ op: "addToken", path: "color/brand/primary", type: "dimension", value: "0px" }])).toEqual({
      op: 1,
      refusal: "There is already a token color/brand/primary.",
    });
  });

  it("still lets setToken write a value over an existing token", () => {
    const next = ok(kit(), [{ op: "setToken", path: "space/gap", type: "dimension", value: "12px" }]);
    expect(next?.tokens.find((token) => token.path === "space/gap")?.value).toBe("12px");
  });
});
