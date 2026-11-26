import { describe, expect, it } from "vitest";
import { applySpans, inspectJsx, worktreeFile, writeJsx, type JsxWrite } from "../src/jsx/index.ts";

const RAIL = `import { cn } from "~/lib/utils";

export function AgentRail({ open, tone }: { open: boolean; tone: string }) {
  return (
    <aside className={cn("flex flex-col", open && "w-80", tone)}>
      <header className="flex h-12 items-center pl-3.5 pr-2">
        <h2   className='m-0 text-sm font-medium'>Agent</h2>
        <span title="Close">{label}</span>
      </header>
      <p style={{ marginTop: 4, color: "red" }}>{\`Hello \${name}\`}</p>
      <Button size="sm" className={buttonVariants({ size })}>Go</Button>
    </aside>
  );
}
`;

const ok = (result: JsxWrite) => {
  if (!result.ok) throw new Error(result.reason);
  return result;
};
const refused = (result: JsxWrite) => (result.ok ? "written" : result.reason);

describe("the JSX writer", () => {
  it("swaps a Tailwind class inside a literal className and keeps everything else byte for byte", () => {
    const result = ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "class", property: "padding-left", before: "pl-3.5", after: "pl-2" }));
    expect(result.text).toBe(RAIL.replace("pl-3.5 pr-2", "pl-2 pr-2"));
    expect(result.edits).toEqual([{ start: RAIL.indexOf("pl-3.5"), end: RAIL.indexOf("pl-3.5") + 6, before: "pl-3.5", after: "pl-2" }]);
    expect(result.line).toBe(6);
    expect(applySpans(result.text, result.edits.map((edit) => ({ start: edit.start, end: edit.start + edit.after.length, before: edit.after, after: edit.before })))).toBe(RAIL);
  });

  it("works in single quotes and in cn() arguments, and adds a class where none sets the property", () => {
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 7, col: 9 }, { kind: "class", property: "font-size", before: "text-sm", after: "text-base" })).text).toContain("<h2   className='m-0 text-base font-medium'>");
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 5, col: 5 }, { kind: "class", property: "flex-direction", before: "flex-col", after: "flex-row" })).text).toContain('cn("flex flex-row", open && "w-80", tone)');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 5, col: 5 }, { kind: "class", property: "padding-left", before: null, after: "pl-2" })).text).toContain('cn("flex flex-col pl-2", open');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 8, col: 9 }, { kind: "class", property: "padding-left", before: null, after: "pl-2" })).text).toContain('<span className="pl-2" title="Close">');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "class", property: "display", before: null, after: "hidden" })).text).toContain('"flex h-12 items-center pl-3.5 pr-2 hidden"');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "class", property: "padding-right", before: "pr-2", after: null })).text).toContain('"flex h-12 items-center pl-3.5"');
  });

  it("replaces static text keeping its whitespace, a literal attribute, and a literal style key", () => {
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 7, col: 9 }, { kind: "text", property: "#text", before: "Agent", after: "Chat" })).text).toContain(">Chat</h2>");
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 7, col: 9 }, { kind: "text", property: "#text", before: "Agent", after: "a {b}" })).text).toContain('>{"a {b}"}</h2>');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 8, col: 9 }, { kind: "attr", property: "title", before: "Close", after: "Shut" })).text).toContain('<span title="Shut">');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 8, col: 9 }, { kind: "attr", property: "aria-label", before: null, after: "Shut" })).text).toContain('<span aria-label="Shut" title="Close">');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 10, col: 7 }, { kind: "style", property: "color", before: "red", after: "#c0392b" })).text).toContain('{{ marginTop: 4, color: "#c0392b" }}');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 10, col: 7 }, { kind: "style", property: "padding-left", before: null, after: "8px" })).text).toContain('{{ marginTop: 4, color: "red", paddingLeft: "8px" }}');
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 7, col: 9 }, { kind: "style", property: "padding-left", before: null, after: "8px" })).text).toContain('<h2 style={{ paddingLeft: "8px" }}   className=');
  });

  it("refuses computed values, classes from props or variants, and positions with no JSX, saying why", () => {
    expect(refused(writeJsx(RAIL, "src/AgentRail.tsx", { line: 5, col: 5 }, { kind: "class", property: "width", before: "w-96", after: "w-80" }))).toMatch(/prop or a variant/);
    expect(refused(writeJsx(RAIL, "src/AgentRail.tsx", { line: 11, col: 7 }, { kind: "class", property: "padding-left", before: "pl-3", after: "pl-2" }))).toMatch(/computed/);
    expect(refused(writeJsx(RAIL, "src/AgentRail.tsx", { line: 8, col: 9 }, { kind: "text", property: "#text", before: "x", after: "y" }))).toMatch(/computed/);
    expect(refused(writeJsx(RAIL, "src/AgentRail.tsx", { line: 10, col: 7 }, { kind: "text", property: "#text", before: "Hello", after: "y" }))).toMatch(/computed/);
    expect(refused(writeJsx(RAIL, "src/AgentRail.tsx", { line: 6, col: 7 }, { kind: "text", property: "#text", before: "Agent", after: "y" }))).toMatch(/more than its text/);
    expect(refused(writeJsx(RAIL, "src/AgentRail.tsx", { line: 2, col: 1 }, { kind: "class", property: "x", before: null, after: "pl-2" }))).toMatch(/No JSX element starts at line 2/);
  });

  it("finds the element by its tag and class when the reported position is off", () => {
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 40, col: 1, tag: "header" }, { kind: "class", property: "padding-left", before: "pl-3.5", after: "pl-2" })).line).toBe(6);
    expect(ok(writeJsx(RAIL, "src/AgentRail.tsx", { line: 7, col: 30, tag: "h2" }, { kind: "text", property: "#text", before: "Agent", after: "Chat" })).line).toBe(7);
  });
});

describe("inspecting JSX", () => {
  it("answers the span, the tag, the class literal and the component around it", () => {
    expect(inspectJsx(RAIL, "src/AgentRail.tsx", { line: 6, col: 7 })).toMatchObject({
      line: 6,
      col: 7,
      endLine: 9,
      endCol: 16,
      tag: "header",
      className: "flex h-12 items-center pl-3.5 pr-2",
      classLiteral: true,
      component: "AgentRail",
    });
    expect(inspectJsx(RAIL, "src/AgentRail.tsx", { line: 5, col: 5 })).toMatchObject({ className: '{cn("flex flex-col", open && "w-80", tone)}', classLiteral: false });
  });

  it("reads the variants a cva call declares", () => {
    const BUTTON = `const buttonVariants = cva("inline-flex", { variants: { variant: { default: "bg-x", ghost: "bg-y" }, size: { sm: "h-8", "icon-sm": "size-8" } }, defaultVariants: { variant: "default", size: "sm" } });
export const Button = ({ className, ...props }) => <button className={cn(buttonVariants({}), className)} {...props} />;
`;
    expect(inspectJsx(BUTTON, "src/button.tsx", { line: 2, col: 51 })?.cva).toEqual([
      {
        name: "buttonVariants",
        variants: [
          { name: "variant", options: ["default", "ghost"], default: "default" },
          { name: "size", options: ["sm", "icon-sm"], default: "sm" },
        ],
      },
    ]);
  });
});

describe("a reported file in the worktree", () => {
  it("resolves absolute paths, dev-server URLs and bundler prefixes, and refuses anything outside", () => {
    expect(worktreeFile("/w/app/src/App.tsx", "/w/app")).toBe("src/App.tsx");
    expect(worktreeFile("/src/App.tsx", "/w/app")).toBe("src/App.tsx");
    expect(worktreeFile("http://localhost:5173/src/App.tsx?t=1", "/w/app")).toBe("src/App.tsx");
    expect(worktreeFile("/@fs/w/app/src/App.tsx", "/w/app")).toBe("src/App.tsx");
    expect(worktreeFile("webpack-internal:///(app-pages-browser)/./src/app/page.tsx", "/w/app")).toBe("src/app/page.tsx");
    expect(worktreeFile("webpack://my-app/./src/App.tsx", "/w/app")).toBe("src/App.tsx");
    expect(worktreeFile("/src/../../etc/passwd", "/w/app")).toBeUndefined();
  });
});
