import { describe, expect, it } from "vitest";
import { joinJsonArray, splitJsonArray } from "../src/index.ts";

describe("splitJsonArray", () => {
  it.each<[string, string, string[]]>([
    ["an empty array", "[]", []],
    ["whitespace around and inside", "  [ \n ]\n", []],
    ["each element's own text, exactly as written", '[{"a": 1,  "b":[1,2]},\n  "x" , 3,null]', ['{"a": 1,  "b":[1,2]}', '"x"', "3", "null"]],
    ["brackets, commas and escaped quotes inside strings", '["a,]b", {"k": "say \\"hi\\", [ok]"}]', ['"a,]b"', '{"k": "say \\"hi\\", [ok]"}']],
    ["nested arrays", "[[1,[2,3]],[]]", ["[1,[2,3]]", "[]"]],
  ])("%s", (_case, text, elements) => {
    expect(splitJsonArray(text)).toEqual(elements);
    expect(elements.map((element) => JSON.parse(element))).toEqual(JSON.parse(text));
  });

  it("answers undefined for anything but an array", () => {
    expect(splitJsonArray('{"a": 1}')).toBeUndefined();
    expect(splitJsonArray("3")).toBeUndefined();
  });
});

describe("joinJsonArray", () => {
  it("writes the elements as they are, one after another, into valid JSON", () => {
    const text = joinJsonArray(['{"a": 1,  "b":[1,2]}', '"x"']);
    expect(JSON.parse(text)).toEqual([{ a: 1, b: [1, 2] }, "x"]);
    expect(text).toContain('{"a": 1,  "b":[1,2]}');
    expect(joinJsonArray([])).toBe("[]\n");
  });
});
