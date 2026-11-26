import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { callsiteFrame, decodeMappings, installSourceModule, originalPosition, sourceKey, sourceModuleSource, stackFrames } from "../src/index.ts";

const tools = { frames: stackFrames, callsite: callsiteFrame, decode: decodeMappings, original: originalPosition, key: sourceKey };

interface FakeEl {
  tagName: string;
  nodeType: 1;
  parentElement: FakeEl | null;
  attrs: Record<string, string>;
  box: { width: number; height: number };
  contains(other: FakeEl): boolean;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  getAttribute(name: string): string | null;
  textContent: string;
  [key: string]: unknown;
}

const element = (tag: string, parent: FakeEl | null = null, box = { width: 100, height: 20 }): FakeEl => ({
  tagName: tag.toUpperCase(),
  nodeType: 1,
  parentElement: parent,
  attrs: {},
  box,
  textContent: "",
  contains(other: FakeEl) {
    for (let at: FakeEl | null = other; at; at = at.parentElement) if (at === this) return true;
    return false;
  },
  getBoundingClientRect() {
    return { left: 0, top: 0, ...this.box };
  },
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  },
});

const fakeWindow = (all: FakeEl[], options: { hook?: unknown; fetch?: (url: string) => string } = {}) => {
  const posted: unknown[] = [];
  const listeners: Array<(event: unknown) => void> = [];
  const parent = { postMessage: (message: unknown) => posted.push(message) };
  const win: any = {
    document: {
      querySelectorAll: () => all,
      querySelector: (selector: string) => all.find((each) => selector.includes(`"${each.attrs["data-hf-id"]}"`)) ?? null,
    },
    parent,
    innerWidth: 1000,
    innerHeight: 800,
    unframedEditPeer: "http://127.0.0.1:4000",
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
    URL,
    atob: (text: string) => Buffer.from(text, "base64").toString("binary"),
    fetch: async (url: string) => ({ ok: true, text: async () => options.fetch?.(url) ?? "" }),
    getComputedStyle: () => ({ getPropertyValue: (name: string) => (name === "padding-left" ? "8px" : "") }),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "message") listeners.push(listener);
    },
  };
  if (options.hook !== undefined) win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = options.hook;
  installSourceModule(win, tools);
  const send = (data: unknown) => listeners.forEach((listener) => listener({ source: parent, origin: "http://127.0.0.1:4000", data }));
  return { win, posted, send };
};

const fiber = (tag: number, fields: Record<string, unknown> = {}): any => ({ tag, child: null, sibling: null, return: null, ...fields });
const link = (parent: any, ...children: any[]) => {
  parent.child = children[0] ?? null;
  children.forEach((child, index) => {
    child.return = parent;
    child.sibling = children[index + 1] ?? null;
  });
  return parent;
};
const host = (el: FakeEl, fields: Record<string, unknown> = {}) => {
  const node = fiber(5, { stateNode: el, ...fields });
  el["__reactFiber$x1"] = node;
  return node;
};

const REACT_19_STACK = (url: string, line: number, col: number) =>
  ["Error: react-stack-top-frame", "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:30)", `    at Card (${url}:${line}:${col})`, "    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js:5000:22)"].join("\n");

describe("stack frames", () => {
  it("reads Chrome and Safari frames and takes the first one outside React as the JSX callsite", () => {
    const frames = stackFrames(REACT_19_STACK("http://localhost:5173/src/Card.tsx?t=17", 12, 7));
    expect(frames.map((frame) => frame.fn)).toEqual(["exports.jsxDEV", "Card", "renderWithHooks"]);
    expect(callsiteFrame(frames)).toEqual({ fn: "Card", url: "http://localhost:5173/src/Card.tsx?t=17", line: 12, col: 7 });
    expect(stackFrames("Card@http://localhost:3000/app.js:4:9")).toEqual([{ fn: "Card", url: "http://localhost:3000/app.js", line: 4, col: 9 }]);
    expect(callsiteFrame(stackFrames("Error\n    at jsxDEV (http://x/a.js:1:1)"))).toBeUndefined();
  });

  it("keys a position without the dev server's query", () => {
    expect(sourceKey({ url: "http://localhost:5173/src/Card.tsx?t=17", line: 3, col: 5 })).toBe("http://localhost:5173/src/Card.tsx:3:5");
    expect(sourceKey({ file: "/repo/src/Card.tsx", line: 3, col: 5 })).toBe("/repo/src/Card.tsx:3:5");
  });
});

const CARD = 'export function Card({ title }) {\n  return (\n    <div className="p-4">\n      <h2>{title}</h2>\n    </div>\n  );\n}\n';
const compiled = () => transformSync(CARD, { loader: "jsx", jsx: "automatic", jsxDev: true, sourcemap: "inline", sourcefile: "/src/Card.jsx", format: "esm" }).code;
const callAt = (code: string, needle: string) => {
  const lines = code.split("\n");
  const line = lines.findIndex((text) => text.includes(needle));
  return { line: line + 1, col: lines[line]!.indexOf(needle) + 1 };
};

describe("source maps", () => {
  it("map a call in the dev server's output back to the JSX that made it", () => {
    const code = compiled();
    const map = JSON.parse(Buffer.from(code.split("base64,")[1]!, "base64").toString("utf8"));
    const decoded = decodeMappings(map.mappings);
    const at = callAt(code, 'jsxDEV("div"');
    expect(originalPosition(decoded, at.line, at.col)).toEqual({ source: 0, line: 3, col: 5 });
    const inner = callAt(code, 'jsxDEV("h2"');
    expect(originalPosition(decoded, inner.line, inner.col)).toEqual({ source: 0, line: 4, col: 7 });
  });
});

describe("the developer-tools hook", () => {
  it("is installed when the page has none, takes React's renderer and reports commits to the editor", () => {
    const { win, posted } = fakeWindow([]);
    const hook = win.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    expect(hook.supportsFiber).toBe(true);
    expect(hook.inject({ version: "19.0.0" })).toBe(1);
    expect(hook.renderers.size).toBe(1);
    hook.onCommitFiberRoot(1, {});
    expect(posted).toContainEqual({ type: "unframed:source:commit", commits: 1 });
  });

  it("wraps a hook that is already there and still calls it", () => {
    const seen: unknown[] = [];
    const existing = { supportsFiber: true, renderers: new Map(), inject: () => 7, onCommitFiberRoot: (...args: unknown[]) => seen.push(args) };
    const { win, posted } = fakeWindow([], { hook: existing });
    expect(win.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(existing);
    existing.onCommitFiberRoot(7, "root");
    expect(seen).toEqual([[7, "root"]]);
    expect(posted).toHaveLength(1);
  });

  it("is carried in the source the bridge serves", () => {
    expect(sourceModuleSource()).toContain("__REACT_DEVTOOLS_GLOBAL_HOOK__");
    expect(() => new Function(sourceModuleSource())).not.toThrow();
  });
});

const page = () => {
  const body = element("body", null, { width: 1000, height: 800 });
  const shell = element("div", body, { width: 1000, height: 800 });
  const list = element("ul", shell, { width: 400, height: 200 });
  const cards = [0, 1, 2].map(() => element("li", list));
  const titles = cards.map((card) => element("h3", card));
  const svgText = element("span", titles[1]!);
  const App = function App() {};
  const List = function List() {};
  const Card = function Card() {};
  const appFiber = fiber(0, { type: App });
  const shellFiber = host(shell, { _debugSource: { fileName: "/repo/src/App.tsx", lineNumber: 5, columnNumber: 5 }, _debugOwner: appFiber });
  link(appFiber, shellFiber);
  const listFiber = fiber(0, { type: List, memoizedProps: { tone: "quiet", onPick: () => undefined, children: [] } });
  link(shellFiber, listFiber);
  const ulFiber = host(list, { _debugSource: { fileName: "/repo/src/List.tsx", lineNumber: 9, columnNumber: 3 }, _debugOwner: listFiber });
  link(listFiber, ulFiber);
  const cardFibers = cards.map((card, index) => {
    const cardFiber = fiber(14, { type: { type: Card }, memoizedProps: { title: `Card ${index}`, data: { a: 1 } } });
    const li = host(card, { _debugSource: { fileName: "/repo/src/Card.tsx", lineNumber: 3, columnNumber: 5 }, _debugOwner: cardFiber });
    const h3 = host(titles[index]!, { _debugSource: { fileName: "/repo/src/Card.tsx", lineNumber: 4, columnNumber: 7 }, _debugOwner: cardFiber });
    link(li, h3);
    link(cardFiber, li);
    return cardFiber;
  });
  link(ulFiber, ...cardFibers);
  link(fiber(3), appFiber);
  return { all: [shell, list, ...cards, ...titles, svgText], shell, list, cards, titles, svgText };
};

describe("an element's source on a React 18 page", () => {
  it("names the JSX, its owner, the component rooted at it with its props, and which of its instances it is", () => {
    const { all, cards } = page();
    const { win } = fakeWindow(all);
    expect(win.__unframedSource.describe(cards[1])).toEqual({
      raw: { file: "/repo/src/Card.tsx", line: 3, col: 5 },
      key: "/repo/src/Card.tsx:3:5",
      selfMapped: true,
      tag: "li",
      owner: "Card",
      instanceOf: "Card",
      props: { title: "Card 1", data: "{…}" },
      instanceIndex: 1,
      instanceCount: 3,
    });
  });

  it("falls back to the nearest mapped ancestor for an element React did not render", () => {
    const { all, svgText } = page();
    const { win } = fakeWindow(all);
    expect(win.__unframedSource.describe(svgText)).toMatchObject({ selfMapped: false, tag: "h3", key: "/repo/src/Card.tsx:4:7", instanceIndex: 1 });
  });

  it("lists component levels outermost first, skipping the app's shell, ending at the element", () => {
    const { all, titles, list, cards } = page();
    const { win } = fakeWindow(all);
    const levels = win.__unframedSource.levels(titles[2]);
    expect(levels.map((level: { el: FakeEl }) => level.el)).toEqual([list, cards[2], titles[2]]);
    expect(levels.map((level: { component: string | null }) => level.component)).toEqual(["List", "Card", null]);
  });

  it("measures a target found again by its JSX and index after a reload", () => {
    const { all, cards } = page();
    const { posted, send } = fakeWindow(all);
    send({ type: "unframed:source:measure", id: 3, targets: [{ key: "/repo/src/Card.tsx:3:5", index: 2, properties: ["padding-left"] }, { key: "/nowhere:1:1" }] });
    expect(posted.at(-1)).toMatchObject({ type: "unframed:source:measured", id: 3, results: [{ found: true, computed: { "padding-left": "8px" } }, { found: false }] });
    expect(cards).toHaveLength(3);
  });
});

describe("an element's source on a React 19 page", () => {
  it("maps the JSX callsite in its debug stack through the dev server's source map", async () => {
    const code = compiled();
    const url = "http://localhost:5173/src/Card.jsx?t=99";
    const at = callAt(code, 'jsxDEV("div"');
    const body = element("body", null, { width: 1000, height: 800 });
    const card = element("div", body);
    card.attrs["data-hf-id"] = "uf4";
    const Card = function Card() {};
    const owner = fiber(0, { type: Card });
    link(owner, host(card, { _debugStack: { stack: REACT_19_STACK(url, at.line, at.col) }, _debugOwner: owner }));
    const { win, posted, send } = fakeWindow([card], { fetch: (asked) => (asked === url ? code : "") });
    const resolved = await win.__unframedSource.resolve(card);
    expect(resolved).toMatchObject({ owner: "Card", selfMapped: true, instanceCount: 1, source: { file: "/src/Card.jsx", line: 3, col: 5, mapped: true } });
    send({ type: "unframed:source:resolve", id: 8, target: { stamp: "uf4" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.at(-1)).toMatchObject({ type: "unframed:source:resolved", id: 8, element: { source: { file: "/src/Card.jsx", line: 3 } } });
  });
});
