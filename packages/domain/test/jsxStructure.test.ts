import { describe, expect, it } from "vitest";
import { writeJsx, type JsxWrite } from "../src/jsx/index.ts";

const HEADER = `export function AgentRail({ items }: { items: string[] }) {
  return (
    <header className="flex h-12 items-center gap-1">
      <Icon />
      <h2 className="text-sm">Agent</h2>
      <Button variant="ghost" size="icon-sm" aria-label="Search">
        <Search />
      </Button>
      <Button variant="ghost" aria-label="New">
        <Plus />
      </Button>
      <Button disabled variant={tone} aria-label="Close" {...rest}>
        <X />
      </Button>
    </header>
  );
}

export function List({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col">
      <li>First</li>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function Card() {
  return <article className={styles.card}>Hi</article>;
}
`;

const ok = (result: JsxWrite) => {
  if (!result.ok) throw new Error(result.reason);
  return result;
};
const refused = (result: JsxWrite) => (result.ok ? "written" : result.reason);
const lines = (text: string, from: number, to: number) => text.split("\n").slice(from - 1, to).join("\n");

describe("structural writes", () => {
  it("moves an element within a static children list, keeping the whitespace between items", () => {
    const result = ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "reorder", property: "#order", before: null, after: null, move: { from: 2, to: 3, count: 5 } }));
    expect(lines(result.text, 4, 15)).toBe(`      <Icon />
      <h2 className="text-sm">Agent</h2>
      <Button variant="ghost" aria-label="New">
        <Plus />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Search">
        <Search />
      </Button>
      <Button disabled variant={tone} aria-label="Close" {...rest}>
        <X />
      </Button>
    </header>`);
    expect(result.edits).toHaveLength(1);
    expect(result.line).toBe(6);
    const back = ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 4, col: 7 }, { kind: "reorder", property: "#order", before: null, after: null, move: { from: 0, to: 4, count: 5 } }));
    expect(lines(back.text, 4, 5)).toBe(`      <h2 className="text-sm">Agent</h2>
      <Button variant="ghost" size="icon-sm" aria-label="Search">`);
    expect(lines(back.text, 13, 14)).toBe(`      </Button>
      <Icon />`);
  });

  it("refuses a move in a mapped list, or when the page and the code disagree", () => {
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 22, col: 7 }, { kind: "reorder", property: "#order", before: null, after: null, move: { from: 0, to: 1, count: 3 } }))).toMatch(/expression/);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "reorder", property: "#order", before: null, after: null, move: { from: 2, to: 3, count: 6 } }))).toMatch(/page shows 6/);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "reorder", property: "#order", before: null, after: null, move: { from: 1, to: 3, count: 5 } }))).toMatch(/position/);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 31, col: 10 }, { kind: "reorder", property: "#order", before: null, after: null, move: { from: 0, to: 1, count: 2 } }))).toMatch(/children/);
  });

  it("duplicates an element right after itself on its own line", () => {
    const result = ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "duplicate", property: "#duplicate", before: null, after: null }));
    expect(lines(result.text, 6, 11)).toBe(`      <Button variant="ghost" size="icon-sm" aria-label="Search">
        <Search />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Search">
        <Search />
      </Button>`);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 31, col: 10 }, { kind: "duplicate", property: "#duplicate", before: null, after: null }))).toMatch(/children/);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 24, col: 9 }, { kind: "duplicate", property: "#duplicate", before: null, after: null }))).toMatch(/children/);
  });

  it("deletes an element with its line, and refuses one that is not a child", () => {
    const result = ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 9, col: 7 }, { kind: "delete", property: "#delete", before: null, after: null }));
    expect(lines(result.text, 6, 12)).toBe(`      <Button variant="ghost" size="icon-sm" aria-label="Search">
        <Search />
      </Button>
      <Button disabled variant={tone} aria-label="Close" {...rest}>
        <X />
      </Button>
    </header>`);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 3, col: 5 }, { kind: "delete", property: "#delete", before: null, after: null }))).toMatch(/children/);
  });

  it("changes a prop literal at the callsite, adds one, and removes one", () => {
    expect(ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "props", property: "variant", before: '"ghost"', after: '"outline"' })).text).toContain('<Button variant="outline" size="icon-sm" aria-label="Search">');
    expect(ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 9, col: 7 }, { kind: "props", property: "size", before: null, after: '"sm"' })).text).toContain('<Button variant="ghost" aria-label="New" size="sm">');
    expect(ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 9, col: 7 }, { kind: "props", property: "loading", before: null, after: "true" })).text).toContain('aria-label="New" loading={true}>');
    expect(ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 12, col: 7 }, { kind: "props", property: "disabled", before: "true", after: "false" })).text).toContain("<Button disabled={false} variant={tone}");
    expect(ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "props", property: "size", before: '"icon-sm"', after: "null" })).text).toContain('<Button variant="ghost" aria-label="Search">');
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 12, col: 7 }, { kind: "props", property: "variant", before: '"ghost"', after: '"outline"' }))).toMatch(/expression/);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "props", property: "variant", before: '"default"', after: '"outline"' }))).toMatch(/not the value/);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "props", property: "variant", before: null, after: "{}" }))).toMatch(/literal/);
  });

  it("hides with the hidden class, and leaves wrapping to the agent", () => {
    expect(ok(writeJsx(HEADER, "src/AgentRail.tsx", { line: 5, col: 7 }, { kind: "hide", property: "display", before: null, after: "hidden" })).text).toContain('<h2 className="text-sm hidden">Agent</h2>');
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 9, col: 7 }, { kind: "hide", property: "display", before: null, after: "hidden" }))).toMatch(/className/);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 31, col: 10 }, { kind: "hide", property: "display", before: null, after: "hidden" }))).toMatch(/computed/);
    expect(refused(writeJsx(HEADER, "src/AgentRail.tsx", { line: 5, col: 7 }, { kind: "wrap", property: "#wrap", before: null, after: null }))).toMatch(/agent/);
  });
});
