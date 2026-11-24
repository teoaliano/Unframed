import { describe, expect, it } from "vitest";
import { limitPatch, parseNumstat } from "../src/index.ts";

describe("an Instance's diff", () => {
  it("reads -z numstat into files sorted by path, binary files without counts", () => {
    expect(parseNumstat("3\t1\tsrc/b.ts\x002\t0\tsrc/a b.ts\x00-\t-\tlogo.png\x00")).toEqual([
      { path: "logo.png", additions: 0, deletions: 0, binary: true },
      { path: "src/a b.ts", additions: 2, deletions: 0, binary: false },
      { path: "src/b.ts", additions: 3, deletions: 1, binary: false },
    ]);
    expect(parseNumstat("")).toEqual([]);
  });

  it("cuts a long patch at the last whole file that fits", () => {
    const one = "diff --git a/a b/a\n+aaaa\n";
    const two = "diff --git a/b b/b\n+bbbb\n";
    expect(limitPatch(one + two, 1000)).toEqual({ patch: one + two, truncated: false });
    expect(limitPatch(one + two, one.length + 5)).toEqual({ patch: one, truncated: true });
  });
});
