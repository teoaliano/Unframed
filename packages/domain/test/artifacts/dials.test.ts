import { describe, expect, it } from "vitest";
import { assignDialValues, defaultDialValues, mergeDialValues, normaliseDials, type DialSchema } from "../../src/index.ts";

const schemaOf = (config: unknown): DialSchema => {
  const normalised = normaliseDials(config);
  if (!normalised.ok) throw new Error(normalised.error);
  return normalised.schema;
};

describe("dial shorthand", () => {
  it.each([
    ["a number", 3, { kind: "number", value: 3 }, 3],
    ["a boolean", true, { kind: "boolean", value: true }, true],
    ["a three-digit hex colour", "#abc", { kind: "color", value: "#abc" }, { type: "color", default: "#abc" }],
    ["a six-digit hex colour", "#A78BFA", { kind: "color", value: "#A78BFA" }, { type: "color", default: "#A78BFA" }],
    ["an eight-digit hex colour", "#a78bfa80", { kind: "color", value: "#a78bfa80" }, { type: "color", default: "#a78bfa80" }],
    ["any other string", "Launch day", { kind: "text", value: "Launch day" }, { type: "text", default: "Launch day" }],
    ["a string that is almost a colour", "#abcd", { kind: "text", value: "#abcd" }, { type: "text", default: "#abcd" }],
    ["three numbers", [1, 0.5, 2], { kind: "range", value: 1, min: 0.5, max: 2 }, [1, 0.5, 2]],
    ["four numbers", [10, 0, 100, 5], { kind: "range", value: 10, min: 0, max: 100, step: 5 }, [10, 0, 100, 5]],
    ["a list of strings", ["stack", "grid"], { kind: "select", value: "stack", options: ["stack", "grid"] }, { type: "select", options: ["stack", "grid"], default: "stack" }],
  ])("reads %s", (_case, value, entry, dialkit) => {
    const normalised = normaliseDials({ key: value });
    expect(normalised).toEqual({ ok: true, schema: { key: entry }, dialkit: { key: dialkit } });
  });

  it("reads an object as a folder of its own parameters", () => {
    expect(normaliseDials({ scene: { speed: [1, 0.5, 2], title: "Hi" }, on: false })).toEqual({
      ok: true,
      schema: {
        scene: { kind: "folder", of: { speed: { kind: "range", value: 1, min: 0.5, max: 2 }, title: { kind: "text", value: "Hi" } } },
        on: { kind: "boolean", value: false },
      },
      dialkit: { scene: { speed: [1, 0.5, 2], title: { type: "text", default: "Hi" } }, on: false },
    });
  });
});

describe("dial refusals", () => {
  it.each([
    ["null", null],
    ["an array", [1, 2, 3]],
    ["a string", "accent"],
    ["nothing", undefined],
  ])("refuses a config that is %s as not an object", (_case, config) => {
    expect(normaliseDials(config)).toEqual({ ok: false, error: "dials: the parameters must be an object" });
  });

  it.each([
    ["two numbers", { speed: [1, 2] }, "dials.speed"],
    ["five numbers", { speed: [1, 2, 3, 4, 5] }, "dials.speed"],
    ["an empty list", { mode: [] }, "dials.mode"],
    ["numbers and strings mixed", { mode: [1, "a", 3] }, "dials.mode"],
    ["a bad array in a nested folder", { scene: { move: { speed: [1, 2] } } }, "dials.scene.move.speed"],
  ])("names the path of %s", (_case, config, path) => {
    expect(normaliseDials(config)).toEqual({ ok: false, error: `${path}: an array must be [value, min, max] numbers or a list of strings` });
  });

  it.each([
    ["null", { accent: null }, "dials.accent"],
    ["a function", { apply: () => 1 }, "dials.apply"],
    ["not a finite number", { scale: Number.NaN }, "dials.scale"],
    ["inside a folder", { scene: { caption: undefined } }, "dials.scene.caption"],
  ])("refuses a value that is %s", (_case, config, path) => {
    expect(normaliseDials(config)).toEqual({ ok: false, error: `${path}: a parameter must be a number, a switch, text, a colour, a range or a list` });
  });

  it("stops at the first refusal", () => {
    expect(normaliseDials({ a: [1], b: null })).toEqual({ ok: false, error: "dials.a: an array must be [value, min, max] numbers or a list of strings" });
  });
});

describe("default values and the merge rule", () => {
  const schema = schemaOf({ accent: "#a78bfa", scale: [1, 0.5, 2], caption: "Tuned", on: true, mode: ["a", "b"], scene: { speed: 2, label: "x" } });

  it("defaults are each entry's value, folders as nested objects", () => {
    expect(defaultDialValues(schema)).toEqual({ accent: "#a78bfa", scale: 1, caption: "Tuned", on: true, mode: "a", scene: { speed: 2, label: "x" } });
  });

  it("takes a saved value of the same type, keeps the default for a missing one, drops a retyped one and unknown keys", () => {
    expect(mergeDialValues(schema, { accent: "#ff0000", scale: "big", on: false, mode: "b", gone: 5, scene: { speed: 3, label: 7, extra: 1 } })).toEqual({
      accent: "#ff0000",
      scale: 1,
      caption: "Tuned",
      on: false,
      mode: "b",
      scene: { speed: 3, label: "x" },
    });
  });

  it("gives the defaults for nothing saved, and for a folder saved as something else", () => {
    expect(mergeDialValues(schema, null)).toEqual(defaultDialValues(schema));
    expect(mergeDialValues(schema, { scene: "flat" }).scene).toEqual({ speed: 2, label: "x" });
  });

  it("a partial set keeps what it does not name, one level per folder", () => {
    const current = { accent: "#000000", scene: { speed: 2, label: "x" } };
    expect(assignDialValues(current, { scene: { speed: 4 } })).toEqual({ accent: "#000000", scene: { speed: 4, label: "x" } });
    expect(assignDialValues(current, "nothing")).toEqual(current);
  });
});
