import { describe, expect, it } from "vitest";
import { addDraft, changeLine, draftInstructionLine, draftOf, groupLine, paddingLine, screenWritesOf, snapToken, structuralDraftOf, tokenScaleOf, type DraftChange, type DraftElement, type DraftNeighbour } from "../src/index.ts";

const element: DraftElement = {
  stamp: "uf9",
  selector: "aside > header > button:nth-of-type(1)",
  name: "Button",
  tag: "button",
  key: "/repo/src/AgentRail.tsx:219:9",
  source: { file: "src/AgentRail.tsx", line: 219, col: 9, endLine: 221, endCol: 18 },
  component: "AgentRail",
  instanceIndex: 0,
  instanceCount: 1,
  selfMapped: true,
};
const at = (line: number, endLine: number) => ({ file: "src/AgentRail.tsx", line, col: 9, endLine, endCol: 18 });
const siblings: DraftNeighbour[] = [
  { label: "Icon", tag: "svg", source: at(216, 216) },
  { label: "Agent", tag: "h2", source: at(217, 217) },
  { label: "Button", tag: "button", source: at(219, 221) },
  { label: "Button", tag: "button", source: at(224, 226) },
  { label: "Button", tag: "button", source: at(229, 231) },
];
const parent: DraftNeighbour = { label: "Header", tag: "header", source: { file: "src/AgentRail.tsx", line: 215, col: 7, endLine: 260, endCol: 15 } };
const style = (property: string, before: string, after: string, extra: Partial<DraftChange> = {}): DraftChange => ({ id: "s", kind: "style", property, before, after, shownBefore: before, asked: after, element, scope: "all", ...extra });
const scale = tokenScaleOf({ css: [{ file: "a.css", text: '@import "tailwindcss";\n@theme { --radius-2xl: 18px; }\n:root { --artifact-editor-preview-size-width: 248px; --action-highlight: oklch(58.8% 0.158 241.966); }' }] });

describe("change lines", () => {
  it("reads a dragged value with its token", () => {
    const header = { id: "d1", element, className: "flex gap-1 pl-3.5", computed: { "padding-left": "8px", gap: "4px" }, text: null };
    expect(changeLine(draftOf({ type: "style", elementId: "uf9", property: "padding-left", value: "20px" }, header, snapToken(scale, "padding-left", 20))!)).toBe("Padding left 8 → 20 pl-5");
    expect(changeLine(draftOf({ type: "style", elementId: "uf9", property: "gap", value: "28px" }, header, snapToken(scale, "gap", 28))!)).toBe("Gap 4 → 28 gap-7");
    expect(changeLine(style("border-radius", "18px", "32px", { token: snapToken(scale, "border-radius", 30)! }))).toBe("Corner radius 18 → 32 radius-4xl");
    expect(changeLine(style("border-radius", "18px", "28px"))).toBe("Corner radius 18 → 28");
    expect(changeLine(style("height", "48px", "60px", { mode: "fixed" }))).toBe("Height 48 → 60");
    expect(changeLine(style("width", "264.797px", "248px", { mode: "fill", token: snapToken(scale, "width", 248)! }))).toBe("Width Fill 265 → 248 artifact-editor-preview-size-width");
    expect(changeLine(style("width", "359px", "359px", { mode: "fill" }))).toBe("Width Fill → Fixed 359");
    expect(changeLine(style("column-gap", "28px", "10px"))).toBe("Gap 28 → 10");
  });

  it("speaks each property the way the panel does", () => {
    expect(changeLine(style("color", "oklch(0.274 0.006 286.033)", "oklch(58.8% 0.158 241.966)", { token: { name: "text-(--action-highlight)", label: "action-highlight", value: "oklch(58.8% 0.158 241.966)", kind: "color" } }))).toBe(
      "Text colour #27272A → #0084D1 action-highlight",
    );
    expect(changeLine(style("background-color", "rgba(0, 0, 0, 0)", "#FFFFFF"))).toBe("Fill #00000000 → #FFFFFF");
    expect(changeLine(style("font-weight", "400", "700"))).toBe("Weight Regular → Bold");
    expect(changeLine(style("font-style", "normal", "italic"))).toBe("Italic off → on");
    expect(changeLine(style("text-decoration-line", "none", "underline"))).toBe("Decoration None → Underline");
    expect(changeLine(style("text-decoration-line", "none", "line-through"))).toBe("Decoration None → Strikethrough");
    expect(changeLine(style("font-size", "14px", "15px"))).toBe("Size 14 → 15");
    expect(changeLine(style("font-size", "var(--text-sm)", "18px", { token: snapToken(scale, "font-size", 18)! }))).toBe("Size var(--text-sm) → 18 text-lg");
    expect(changeLine(style("line-height", "24px", "39px"))).toBe("Line height 24 → 39");
    expect(changeLine(style("letter-spacing", "normal", "0.1em"))).toBe("Letter spacing 0% → 10%");
    expect(changeLine(style("text-align", "start", "center"))).toBe("Text align Left → Center");
    expect(changeLine(style("opacity", "1", "0.5"))).toBe("Opacity 100% → 50%");
    expect(changeLine(style("rotate", "none", "5deg"))).toBe("Rotation 0° → 5°");
    expect(changeLine(style("position", "static", "absolute"))).toBe("Position static → absolute");
    expect(changeLine(style("left", "auto", "0px"))).toBe("X auto → 0");
    expect(changeLine(style("top", "auto", "0px"))).toBe("Y auto → 0");
    expect(changeLine(style("box-shadow", "none", "0px 4px 4px 0px #00000040"))).toBe("Shadow none → Drop 0 4 4 0 #00000040");
    expect(changeLine(style("box-shadow", "none", "inset 0 2px 4px rgb(0 0 0 / 0.5)"))).toBe("Shadow none → Inner 0 2 4 0 #00000080");
    expect(changeLine(style("justify-content", "normal", "center"))).toBe("Alignment left → center");
    expect(changeLine({ ...style("#text", "Build a warm, editorial page", "Build a warm, calm page"), kind: "text" })).toBe("Text “Build a warm, editorial page” → “Build a warm, calm page”");
    expect(changeLine({ ...style("#text", "a".repeat(60), "b"), kind: "text" })).toBe(`Text “${"a".repeat(39)}…” → “b”`);
  });

  it("formats padding across sides", () => {
    expect(paddingLine({ top: 0, right: 8, bottom: 0, left: 20 }, { top: 0, right: 12, bottom: 0, left: 12 })).toBe("Padding right 8 → 12 · left 20 → 12");
    expect(paddingLine({ top: 0, right: 8, bottom: 0, left: 20 }, { top: 4, right: 13, bottom: 4, left: 13 })).toBe("Padding 0 · 8 · 0 · 20 → 4 · 13 · 4 · 13");
    expect(paddingLine({ top: 0, right: 8, bottom: 0, left: 8 }, { top: 0, right: 8, bottom: 0, left: 20 }, { name: "pl-5", label: "pl-5" })).toBe("Padding left 8 → 20 pl-5");
    const right = style("padding-right", "8px", "12px");
    const left = style("padding-left", "20px", "12px");
    expect(groupLine([right, left])).toBe("Padding right 8 → 12 · left 20 → 12");
    expect(groupLine([style("flex-grow", "1", "0"), style("height", "20px", "20px", { mode: "hug" })])).toBe("Flex grow 1 → 0 · Height Hug → Fixed 20");
  });

  it("reads structural changes", () => {
    const reorder = structuralDraftOf({ type: "reorder", from: 2, to: 3, siblings, parent }, { id: "r", element });
    expect(changeLine(reorder)).toBe("Moved after Button");
    expect(changeLine(structuralDraftOf({ type: "reorder", from: 2, to: 1, siblings, parent }, { id: "r", element }))).toBe("Moved after Icon");
    expect(changeLine(structuralDraftOf({ type: "reorder", from: 2, to: 0, siblings, parent }, { id: "r", element }))).toBe("Moved before Icon");
    expect(changeLine(structuralDraftOf({ type: "duplicate", parent }, { id: "d", element }))).toBe("Duplicated (the copy right after it)");
    expect(changeLine(structuralDraftOf({ type: "delete", parent }, { id: "x", element }))).toBe("Deleted");
    expect(changeLine(structuralDraftOf({ type: "wrap" }, { id: "w", element }))).toBe("Wrapped it in a new frame (flexbox, column)");
    expect(changeLine(structuralDraftOf({ type: "hide" }, { id: "h", element }))).toBe("Hidden");
    expect(changeLine(structuralDraftOf({ type: "props", props: { variant: "outline" }, before: { variant: "ghost" } }, { id: "p", element }))).toBe("variant ghost → outline");
    expect(changeLine(structuralDraftOf({ type: "props", props: { running: true, size: "sm" }, before: { running: false } }, { id: "p", element }))).toBe("running off → on · size none → sm");
  });
});

describe("writes", () => {
  it("turns drafts into writes for Apply", () => {
    const reorder = structuralDraftOf({ type: "reorder", from: 2, to: 3, siblings, parent }, { id: "r", element });
    expect(screenWritesOf(reorder)).toEqual([{ id: "r", kind: "reorder", property: "#order", before: null, after: null, file: "src/AgentRail.tsx", line: 219, col: 9, tag: "button", move: { from: 2, to: 3, count: 5 } }]);
    expect(screenWritesOf(structuralDraftOf({ type: "hide" }, { id: "h", element }))).toEqual([{ id: "h", kind: "hide", property: "display", before: null, after: "hidden", file: "src/AgentRail.tsx", line: 219, col: 9, tag: "button" }]);
    expect(screenWritesOf(structuralDraftOf({ type: "props", props: { variant: "outline", size: "sm" }, before: { variant: "ghost" } }, { id: "p", element })).map((write) => [write.id, write.property, write.before, write.after])).toEqual([
      ["p:variant", "variant", '"ghost"', '"outline"'],
      ["p:size", "size", null, '"sm"'],
    ]);
    expect(screenWritesOf(structuralDraftOf({ type: "props", props: { variant: "outline" }, before: { variant: "ghost" } }, { id: "p", element }))[0]!.id).toBe("p");
    expect(screenWritesOf(style("gap", "4px", "8px"))).toHaveLength(1);
    expect(screenWritesOf({ ...style("gap", "4px", "8px"), element: { ...element, source: null } })).toEqual([]);
  });
});

describe("agent instructions for structural changes", () => {
  const line = (change: DraftChange) => draftInstructionLine(change, "The children are a mapped list.", change.element.source);

  it("names the element, its parent and the order before and after a move", () => {
    expect(line(structuralDraftOf({ type: "reorder", from: 2, to: 3, siblings, parent }, { id: "r", element }))).toBe(
      '- Move <button> in "AgentRail" at "src/AgentRail.tsx":219:9–221:18 right after <button> at "src/AgentRail.tsx":224:9–226:18 inside <header> at "src/AgentRail.tsx":215:7–260:15. The items on the page, in order before the move: 1 "Icon", 2 "Agent", 3 "Button", 4 "Button", 5 "Button". This one, 3, goes right after 4, so the order after is: 1 "Icon", 2 "Agent", 4 "Button", 3 "Button", 5 "Button". The children are a mapped list.',
    );
    expect(line(structuralDraftOf({ type: "reorder", from: 2, to: 0, siblings, parent }, { id: "r", element }))).toContain('right before <svg> at "src/AgentRail.tsx":216:9–216:18');
  });

  it("says what to do for duplicate, delete, wrap, hide and props", () => {
    expect(line(structuralDraftOf({ type: "duplicate", parent }, { id: "d", element }))).toBe('- Duplicate <button> in "AgentRail" at "src/AgentRail.tsx":219:9–221:18: the copy right after it inside <header> at "src/AgentRail.tsx":215:7–260:15. The children are a mapped list.');
    expect(line(structuralDraftOf({ type: "delete", parent }, { id: "x", element }))).toBe(
      '- Remove <button> in "AgentRail" at "src/AgentRail.tsx":219:9–221:18 inside <header> at "src/AgentRail.tsx":215:7–260:15. Then remove what only it used and nothing uses now: an import, a helper or a handler, a style rule nothing else matches; never what another element or a prop still reads. The children are a mapped list.',
    );
    expect(line(structuralDraftOf({ type: "wrap" }, { id: "w", element }))).toBe('- Wrap <button> in "AgentRail" at "src/AgentRail.tsx":219:9–221:18 in a new <div> laid out as display: flex; flex-direction: column; align-items: stretch. The children are a mapped list.');
    expect(line(structuralDraftOf({ type: "hide" }, { id: "h", element }))).toBe('- Hide <button> in "AgentRail" at "src/AgentRail.tsx":219:9–221:18 (render it conditionally, or remove it if it is never wanted). The children are a mapped list.');
    expect(line(structuralDraftOf({ type: "props", props: { variant: "outline" }, before: { variant: "ghost" } }, { id: "p", element }))).toBe(
      '- On this <button> in "AgentRail" at its call site, "src/AgentRail.tsx":219:9–221:18: variant="ghost" → variant="outline". The children are a mapped list.',
    );
  });
});

describe("repeated structural edits", () => {
  it("merges two moves of one element into one from the first position, and drops a move back home", () => {
    const first = structuralDraftOf({ type: "reorder", from: 2, to: 3, siblings, parent }, { id: "r1", element });
    const order = [siblings[0]!, siblings[1]!, siblings[3]!, siblings[2]!, siblings[4]!];
    const second = structuralDraftOf({ type: "reorder", from: 3, to: 4, siblings: order, parent }, { id: "r2", element });
    const merged = addDraft([first], second);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "r1", move: { from: 2, to: 4, siblings } });
    expect(changeLine(merged[0]!)).toBe("Moved after Button");
    const home = structuralDraftOf({ type: "reorder", from: 3, to: 2, siblings: order, parent }, { id: "r3", element });
    expect(addDraft([first], home)).toEqual([]);
  });

  it("merges props, keeping what they were first, and keeps every duplicate", () => {
    const one = structuralDraftOf({ type: "props", props: { variant: "outline" }, before: { variant: "ghost", size: "sm" } }, { id: "p1", element });
    const two = structuralDraftOf({ type: "props", props: { size: "lg" }, before: { variant: "outline", size: "sm" } }, { id: "p2", element });
    expect(addDraft([one], two)[0]).toMatchObject({ id: "p1", props: { variant: "outline", size: "lg" }, propsBefore: { variant: "ghost", size: "sm" } });
    const back = structuralDraftOf({ type: "props", props: { variant: "ghost" }, before: { variant: "outline" } }, { id: "p3", element });
    expect(addDraft([one], back)).toEqual([]);
    const copy = structuralDraftOf({ type: "duplicate", parent }, { id: "c1", element });
    expect(addDraft([copy], { ...copy, id: "c2" })).toHaveLength(2);
  });
});
