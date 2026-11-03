import { describe, expect, it } from "vitest";
import { offTokenNote, OFF_TOKEN_ADVICE, type OffTokenValue } from "../../src/kits/index.ts";

const value = (literal: string, css: string, exact: boolean, tokenValue = "#1a73e8"): OffTokenValue => ({
  place: { elementId: "a" },
  property: "color",
  value: literal,
  path: "color/brand/primary",
  css,
  tokenValue,
  exact,
});

describe("the off-token note (spec 19, task 16)", () => {
  it("answers nothing when the file has no off-token value", () => {
    expect(offTokenNote([])).toBeUndefined();
  });

  it("words an exact value and a near one, and repeats a literal once with a count", () => {
    const note = offTokenNote([
      value("#1a73e8", "--color-brand-primary", true),
      value("#1a73e8", "--color-brand-primary", true),
      value("#1b74e9", "--color-brand-primary", false),
    ]);
    expect(note).toEqual({
      count: 3,
      notes: ["#1a73e8 is --color-brand-primary (×2)", "#1b74e9 is near --color-brand-primary (#1a73e8)"],
      advice: OFF_TOKEN_ADVICE,
    });
  });

  it("caps the notes at ten and says how many more there are", () => {
    const values = Array.from({ length: 13 }, (_, index) => value(`#00000${index}`, `--c${index}`, true));
    const note = offTokenNote(values)!;
    expect(note.count).toBe(13);
    expect(note.notes).toHaveLength(11);
    expect(note.notes.at(-1)).toBe("and 3 more");
  });
});
