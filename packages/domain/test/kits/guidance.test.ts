import { describe, expect, it } from "vitest";
import { applyKitOps } from "../../src/kits/ops.ts";
import { mergeKit, replaceKit, GUIDANCE_CHOICE } from "../../src/kits/merge.ts";
import { fromDtcg, toDtcg } from "../../src/kits/formats.ts";
import { kitRefusal } from "../../src/kits/rules.ts";
import type { Kit } from "../../src/kits/types.ts";

/** Spec 19: a kit's guidance is one more value, set by an op, merged three ways, and carried by DTCG. */

const kit = (guidance?: string): Kit => ({
  format: 1,
  name: "Brand",
  modes: ["light"],
  tokens: [{ path: "color/a", type: "color", value: "#000000" }],
  ...(guidance === undefined ? {} : { guidance }),
});
const side = (guidance?: string) => ({ modes: ["light"], tokens: [{ path: "color/a", type: "color" as const, value: "#000000" }], guidance });

describe("setGuidance", () => {
  it("sets, replaces and with an empty text removes the guidance", () => {
    const set = applyKitOps(kit(), [{ op: "setGuidance", guidance: "## Voice\n\nPlain." }]);
    expect(set).toEqual({ ok: true, kit: kit("## Voice\n\nPlain.") });
    const cleared = applyKitOps(kit("old"), [{ op: "setGuidance", guidance: "  \n" }]);
    expect(cleared).toEqual({ ok: true, kit: kit() });
  });

  it("refuses guidance past the limit, naming the op", () => {
    const result = applyKitOps(kit(), [{ op: "setGuidance", guidance: "x".repeat(100_001) }]);
    expect(result).toEqual({ ok: false, op: 1, refusal: "Guidance is text of at most 100000 characters." });
    expect(kitRefusal(kit("x".repeat(100_000)))).toBeNull();
  });
});

describe("the guidance in the merge", () => {
  const merge = (project?: string, base?: string, library?: string, choices = {}) => mergeKit({ project: kit(project), base: side(base), library: side(library) }, choices);

  it("takes the library's when only the library changed it", () => {
    const result = merge("a", "a", "b");
    expect(result.kit.guidance).toBe("b");
    expect(result.guidance).toBe("updated");
    expect(result.guidanceConflict).toBeUndefined();
  });

  it("keeps the project's when only the project changed it, a removal included", () => {
    expect(merge("mine", "a", "a")).toMatchObject({ kit: { guidance: "mine" }, guidance: "kept" });
    const removed = merge(undefined, "a", "a");
    expect(removed.kit.guidance).toBeUndefined();
    expect(removed.guidance).toBe("kept");
  });

  it("changes nothing when neither changed it or both changed it the same way", () => {
    expect(merge("a", "a", "a").guidance).toBeUndefined();
    expect(merge("b", "a", "b")).toMatchObject({ kit: { guidance: "b" } });
    expect(merge("b", "a", "b").guidance).toBeUndefined();
  });

  it("is a conflict when both changed it differently, keeping the project's unless the person takes the kit's", () => {
    const kept = merge("mine", "a", "theirs");
    expect(kept.guidance).toBe("conflict");
    expect(kept.guidanceConflict).toEqual({ here: "mine", kit: "theirs" });
    expect(kept.kit.guidance).toBe("mine");
    expect(merge("mine", "a", "theirs", { [GUIDANCE_CHOICE]: "kit" }).kit.guidance).toBe("theirs");
  });

  it("adds a library's first guidance to a project that had none", () => {
    expect(merge(undefined, undefined, "new")).toMatchObject({ kit: { guidance: "new" }, guidance: "updated" });
  });

  it("gives a replaced kit the library kit's guidance, or keeps the project's when the library kit has none", () => {
    expect(replaceKit(kit("mine"), kit("theirs")).guidance).toBe("theirs");
    expect(replaceKit(kit("mine"), kit()).guidance).toBe("mine");
  });
});

describe("the guidance in DTCG", () => {
  it("round-trips through the unframed extension", () => {
    const text = toDtcg(kit("## Voice\n\nPlain."));
    expect(JSON.parse(text).$extensions["org.unframed"].guidance).toBe("## Voice\n\nPlain.");
    const back = fromDtcg([{ name: "kit.tokens.json", text }]);
    expect(back.ok && back.fragment.guidance).toBe("## Voice\n\nPlain.");
  });
});
