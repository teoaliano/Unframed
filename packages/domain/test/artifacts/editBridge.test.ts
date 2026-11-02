import { describe, expect, it } from "vitest";
import { editBridgeSource } from "../../src/index.ts";

type Listener = (event: any) => void;

/** A minimal element: attributes, inline style, a box, and text-only children when given text. */
class FakeStyle {
  readonly values = new Map<string, { value: string; priority: string }>();
  getPropertyValue(name: string): string {
    return this.values.get(name)?.value ?? "";
  }
  getPropertyPriority(name: string): string {
    return this.values.get(name)?.priority ?? "";
  }
  setProperty(name: string, value: string, priority = ""): void {
    this.values.set(name, { value, priority });
  }
  removeProperty(name: string): string {
    const old = this.getPropertyValue(name);
    this.values.delete(name);
    return old;
  }
}

class FakeElement {
  readonly nodeType = 1;
  readonly children: FakeElement[] = [];
  readonly childNodes: Array<{ nodeType: number }> = [];
  parentElement: FakeElement | null = null;
  readonly style = new FakeStyle();
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly tagName: string;
  rect = { left: 0, top: 0, width: 10, height: 10 };
  /** Computed values this element reports; a property not set reads as its inline value. */
  computed: Record<string, string> = {};
  private text: string | null = null;

  constructor(tag: string, options: { text?: string; attrs?: Record<string, string> } = {}) {
    this.tagName = tag.toUpperCase();
    if (options.text !== undefined) {
      this.text = options.text;
      this.childNodes.push({ nodeType: 3 });
    }
    for (const [name, value] of Object.entries(options.attrs ?? {})) this.attrs.set(name, value);
  }
  get textContent(): string | null {
    return this.text;
  }
  set textContent(value: string | null) {
    this.text = value;
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  getBoundingClientRect() {
    return this.rect;
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((each) => each !== listener));
  }
  blur(): void {
    for (const listener of this.listeners.get("blur") ?? []) listener({});
  }
  /** Adds a child element; the child's parent is this one. */
  add(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
}

class FakeDocument {
  readonly body = new FakeElement("body");
  visibilityState = "visible";
  readyState = "complete";
  hit: FakeElement | null = null;
  private readonly listeners: Array<{ type: string; listener: Listener }> = [];

  all(root: FakeElement = this.body): FakeElement[] {
    return root.children.flatMap((child) => [child, ...this.all(child)]);
  }
  querySelector(selector: string): FakeElement | null {
    const match = /^\[data-hf-id="(.+)"\]$/.exec(selector);
    if (match === null) return null;
    return this.all().find((el) => el.getAttribute("data-hf-id") === match[1]) ?? null;
  }
  elementFromPoint(): FakeElement | null {
    return this.hit;
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.push({ type, listener });
  }
  removeEventListener(type: string, listener: Listener): void {
    const at = this.listeners.findIndex((each) => each.type === type && each.listener === listener);
    if (at >= 0) this.listeners.splice(at, 1);
  }
  listening(type: string): number {
    return this.listeners.filter((each) => each.type === type).length;
  }
  /** Fires an event at the document's capture listeners; answers whether a listener prevented its default. */
  fire(type: string, target: FakeElement | null, init: Record<string, unknown> = {}): boolean {
    let prevented = false;
    const event = { type, target, key: "", shiftKey: false, metaKey: false, ctrlKey: false, clientX: 0, clientY: 0, ...init, preventDefault: () => (prevented = true) };
    for (const each of [...this.listeners]) if (each.type === type) each.listener(event);
    return prevented;
  }
}

const ORIGIN = "http://localhost:18787";

/** The shipped edit bridge, run against a stub window whose parent records what it is sent. */
const stubEditWindow = (options: { peer?: string; timelines?: unknown; loading?: boolean } = {}) => {
  const posted: Array<{ message: any; targetOrigin: string }> = [];
  const errors: unknown[][] = [];
  const listeners: Listener[] = [];
  const others = new Map<string, Array<() => void>>();
  const scrolls: Array<[number, number]> = [];
  const frames: Array<() => void> = [];
  const timers = new Map<number, { callback: () => void }>();
  let nextTimer = 1;
  const document = new FakeDocument();
  if (options.loading) document.readyState = "loading";
  const parent = { postMessage: (message: unknown, targetOrigin: string) => posted.push({ message, targetOrigin }) };
  const win: any = {
    parent,
    location: { origin: ORIGIN },
    document,
    console: { error: (...args: unknown[]) => errors.push(args) },
    scrollX: 0,
    scrollY: 0,
    scrollTo: (x: number, y: number) => {
      scrolls.push([x, y]);
      win.scrollX = x;
      win.scrollY = y;
    },
    addEventListener: (type: string, listener: Listener | (() => void)) => {
      if (type === "message") listeners.push(listener as Listener);
      else others.set(type, [...(others.get(type) ?? []), listener as () => void]);
    },
    getComputedStyle: (el: FakeElement) => ({
      getPropertyValue: (name: string) => (name in el.computed ? el.computed[name] : el.style.getPropertyValue(name)),
    }),
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    setTimeout: (callback: () => void) => {
      timers.set(nextTimer, { callback });
      return nextTimer++;
    },
    clearTimeout: (timer: number) => timers.delete(timer),
    ...(options.peer === undefined ? {} : { unframedEditPeer: options.peer }),
    ...(options.timelines === undefined ? {} : { __timelines: options.timelines }),
  };
  // The shipped file, evaluated as a browser would run it.
  new Function("window", editBridgeSource())(win);
  const send = (data: unknown, from: { source?: unknown; origin?: string } = {}) => {
    for (const listener of listeners) listener({ source: from.source ?? parent, origin: from.origin ?? "http://127.0.0.1:5001", data });
  };
  /** Runs the frames queued so far, as the browser would at the next paint. */
  const flush = () => {
    for (const frame of frames.splice(0)) frame();
  };
  const mode = (value: "edit" | "interact", locked: string[] = []) => send({ type: "unframed:edit:mode", mode: value, locked });
  const messages = (type: string) => posted.filter((entry) => entry.message.type === type).map((entry) => entry.message);
  const element = (id: string, options: { tag?: string; text?: string; attrs?: Record<string, string>; parent?: FakeElement } = {}) =>
    (options.parent ?? document.body).add(new FakeElement(options.tag ?? "div", { ...(options.text === undefined ? {} : { text: options.text }), attrs: { "data-hf-id": id, ...options.attrs } }));
  /** Fires every timer still waiting, as the time passing would. */
  const runTimers = () => {
    for (const [timer, entry] of [...timers]) {
      timers.delete(timer);
      entry.callback();
    }
  };
  /** Fires a window event (`load`, `scroll`) at the listeners the bridge added. */
  const fire = (type: string) => {
    for (const listener of others.get(type) ?? []) listener();
  };
  return { win, document, posted, errors, send, flush, fire, scrolls, mode, messages, element, parent, runTimers };
};

describe("the built edit bridge", () => {
  it("starts with the generated-file comment and says ready to the origin it loaded from", () => {
    expect(editBridgeSource().split("\n")[0]).toMatch(/^\/\* unframed-edit\.js: generated by Unframed and rewritten on every write\. Do not edit it here/);
    const { posted } = stubEditWindow({ peer: "http://127.0.0.1:5001" });
    expect(posted).toEqual([{ message: { type: "unframed:edit:ready" }, targetOrigin: "http://127.0.0.1:5001" }]);
  });

  it("answers every hello with ready, to the hello's origin", () => {
    const { send, messages, posted } = stubEditWindow();
    send({ type: "unframed:edit:hello" }, { origin: "http://127.0.0.1:5001" });
    expect(posted.at(-1)).toEqual({ message: { type: "unframed:edit:ready" }, targetOrigin: "http://127.0.0.1:5001" });
    expect(messages("unframed:edit:ready")).toHaveLength(2);
  });

  it("accepts a message only from its parent with its own origin or a loopback one", () => {
    const { document, element, send, mode, messages } = stubEditWindow();
    const el = element("hf-aaaa");
    send({ type: "unframed:edit:mode", mode: "edit", locked: [] }, { source: {}, origin: "http://127.0.0.1:5001" });
    expect(document.listening("click")).toBe(0);
    send({ type: "unframed:edit:mode", mode: "edit", locked: [] }, { origin: "https://evil.example" });
    expect(document.listening("click")).toBe(0);
    send({ type: "unframed:edit:mode", mode: "edit", locked: [] }, { origin: "http://localhost.evil.example:80" });
    expect(document.listening("click")).toBe(0);
    mode("edit");
    expect(document.listening("click")).toBe(1);
    expect(document.fire("click", el, { shiftKey: true })).toBe(true);
    expect(messages("unframed:edit:pick")).toEqual([expect.objectContaining({ element: expect.objectContaining({ id: "hf-aaaa" }), additive: true })]);
  });

  it("applies a style patch at once, keeps the first value, and puts every original back on reset", () => {
    const { document, element, send, messages, win } = stubEditWindow();
    const el = element("hf-aaaa");
    el.style.setProperty("color", "red");
    const patch = (value: string | null) => send({ type: "unframed:edit:patch", patches: [{ type: "style", elementId: "hf-aaaa", property: "color", value }] });
    patch("#a78bfa");
    expect(el.style.getPropertyValue("color")).toBe("#a78bfa");
    patch("blue");
    expect(el.style.getPropertyValue("color")).toBe("blue");
    // A property that had no inline value is removed again on reset.
    send({ type: "unframed:edit:patch", patches: [{ type: "style", elementId: "hf-aaaa", property: "gap", value: "8px" }] });
    expect(el.style.getPropertyValue("gap")).toBe("8px");
    send({ type: "unframed:edit:reset" });
    expect(el.style.getPropertyValue("color")).toBe("red");
    expect(el.style.getPropertyValue("gap")).toBe("");
    expect(messages("unframed:edit:report").at(-1).elements[0]).toEqual(expect.objectContaining({ id: "hf-aaaa", overridden: false }));
  });

  it("flags a patch that a stylesheet rule wins over, when the computed value stays put", () => {
    const { element, send, messages } = stubEditWindow();
    const el = element("hf-aaaa");
    el.computed.color = "rgb(0, 0, 0)";
    send({ type: "unframed:edit:patch", patches: [{ type: "style", elementId: "hf-aaaa", property: "color", value: "#a78bfa" }] });
    expect(messages("unframed:edit:report").at(-1).elements[0].overridden).toBe(true);
  });

  it("hides with an important display declaration and shows again, restoring the original", () => {
    const { element, send } = stubEditWindow();
    const el = element("hf-aaaa");
    el.style.setProperty("display", "flex");
    const hide = (hidden: boolean) => send({ type: "unframed:edit:patch", patches: [{ type: "hide", elementId: "hf-aaaa", hidden }] });
    hide(true);
    expect([el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")]).toEqual(["none", "important"]);
    hide(false);
    expect([el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")]).toEqual(["flex", ""]);
    hide(true);
    send({ type: "unframed:edit:reset" });
    expect(el.style.getPropertyValue("display")).toBe("flex");
  });

  it("patches text and an image's source, dropping srcset and sizes, and restores them on reset", () => {
    const { element, send } = stubEditWindow();
    const title = element("hf-aaaa", { text: "Old title" });
    const picture = element("hf-bbbb", { tag: "img", attrs: { src: "a.png", srcset: "a2.png 2x", sizes: "10px" } });
    send({
      type: "unframed:edit:patch",
      patches: [
        { type: "text", elementId: "hf-aaaa", text: "New title" },
        { type: "image", elementId: "hf-bbbb", target: "src", file: "b.png" },
      ],
    });
    expect(title.textContent).toBe("New title");
    expect(picture.getAttribute("src")).toBe("b.png");
    expect(picture.getAttribute("srcset")).toBeNull();
    send({ type: "unframed:edit:reset" });
    expect(title.textContent).toBe("Old title");
    expect(picture.getAttribute("src")).toBe("a.png");
    expect(picture.getAttribute("srcset")).toBe("a2.png 2x");
    expect(picture.getAttribute("sizes")).toBe("10px");
  });

  it("does not prevent or pick in Interact mode, and removes every listener", () => {
    const { document, element, mode, messages } = stubEditWindow();
    const el = element("hf-aaaa");
    mode("edit");
    expect(document.fire("click", el)).toBe(true);
    mode("interact");
    expect(document.listening("click")).toBe(0);
    expect(document.listening("pointermove")).toBe(0);
    expect(document.fire("click", el)).toBe(false);
    expect(messages("unframed:edit:pick")).toHaveLength(1);
  });

  it("reports a hover once per element and never a locked one or what is inside it", () => {
    const { document, element, mode, messages } = stubEditWindow();
    const outer = element("hf-aaaa");
    const inner = element("hf-bbbb", { parent: outer });
    mode("edit", ["hf-aaaa"]);
    document.fire("pointermove", inner);
    document.fire("pointermove", inner);
    expect(messages("unframed:edit:hover")).toEqual([]);
    mode("edit", []);
    document.fire("pointermove", inner);
    document.fire("pointermove", inner);
    expect(messages("unframed:edit:hover").map((message) => message.element?.id)).toEqual(["hf-bbbb"]);
  });

  it("starts a text edit on a double-click of text, ends it on Enter with the text, and drops it on Esc", () => {
    const { document, element, mode, send, messages } = stubEditWindow();
    const el = element("hf-aaaa", { text: "Hello" });
    mode("edit");
    expect(document.fire("dblclick", el)).toBe(true);
    expect(messages("unframed:edit:textStart")).toEqual([{ type: "unframed:edit:textStart", id: "hf-aaaa" }]);
    send({ type: "unframed:edit:textEdit", id: "hf-aaaa" });
    expect(el.getAttribute("contenteditable")).toBe("plaintext-only");
    el.textContent = "Hello there";
    expect(document.fire("keydown", el, { key: "Enter" })).toBe(true);
    expect(messages("unframed:edit:text")).toEqual([{ type: "unframed:edit:text", id: "hf-aaaa", text: "Hello there" }]);
    expect(el.getAttribute("contenteditable")).toBeNull();

    send({ type: "unframed:edit:textEdit", id: "hf-aaaa" });
    el.textContent = "Typo";
    document.fire("keydown", el, { key: "Escape" });
    expect(el.textContent).toBe("Hello there");
    expect(messages("unframed:edit:text")).toHaveLength(1);
  });

  it("leaves typing alone during a text edit, and does not prevent the keys of the text", () => {
    const { document, element, mode, send } = stubEditWindow();
    const el = element("hf-aaaa", { text: "Hi" });
    mode("edit");
    send({ type: "unframed:edit:textEdit", id: "hf-aaaa" });
    expect(document.fire("keydown", el, { key: "v" })).toBe(false);
    expect(document.fire("keydown", el, { key: " " })).toBe(false);
  });

  it("holds the keys typed during a pending text edit, and applies them in order once the editor answers", () => {
    const { document, element, mode, send, messages } = stubEditWindow();
    const el = element("hf-aaaa", { text: "Welcome" });
    mode("edit");
    document.fire("dblclick", el);
    // Typed before the answer: nothing is forwarded to the editor, and the page takes none of it.
    expect(document.fire("keydown", el, { key: "H" })).toBe(true);
    document.fire("keydown", el, { key: "i" });
    document.fire("keydown", el, { key: " " });
    document.fire("keydown", el, { key: "V" });
    document.fire("keydown", el, { key: " " });
    document.fire("keydown", el, { key: "I" });
    expect(messages("unframed:edit:key")).toEqual([]);
    expect(el.textContent).toBe("Welcome");
    send({ type: "unframed:edit:textEdit", id: "hf-aaaa" });
    expect(el.textContent).toBe("Hi V I");
    expect(el.getAttribute("contenteditable")).toBe("plaintext-only");
    // Enter after the held keys writes the text as typed.
    document.fire("keydown", el, { key: "Enter" });
    expect(messages("unframed:edit:text")).toEqual([{ type: "unframed:edit:text", id: "hf-aaaa", text: "Hi V I" }]);
  });

  it("applies Backspace and Enter among held keys, and ends the edit on Enter", () => {
    const { document, element, mode, send, messages } = stubEditWindow();
    const el = element("hf-aaaa", { text: "Welcome" });
    mode("edit");
    document.fire("dblclick", el);
    for (const key of ["A", "B", "Backspace", "C", "Enter"]) document.fire("keydown", el, { key });
    send({ type: "unframed:edit:textEdit", id: "hf-aaaa" });
    expect(messages("unframed:edit:text")).toEqual([{ type: "unframed:edit:text", id: "hf-aaaa", text: "AC" }]);
    expect(el.getAttribute("contenteditable")).toBeNull();
  });

  it("drops the held keys when the editor does not answer within a second, and forwards the keys after that", () => {
    const { document, element, mode, runTimers, messages } = stubEditWindow();
    const el = element("hf-aaaa", { text: "Welcome" });
    mode("edit");
    document.fire("dblclick", el);
    document.fire("keydown", el, { key: "x" });
    runTimers();
    expect(messages("unframed:edit:key")).toEqual([]);
    expect(el.textContent).toBe("Welcome");
    document.fire("keydown", null, { key: "v" });
    expect(messages("unframed:edit:key")).toEqual([{ type: "unframed:edit:key", key: "v", shift: false, meta: false, ctrl: false }]);
  });

  it("forwards V, I, Esc, Shift+Enter and the undo keys, and keeps every other key from the page", () => {
    const { document, mode, messages } = stubEditWindow();
    mode("edit");
    expect(document.fire("keydown", null, { key: "v" })).toBe(true);
    document.fire("keydown", null, { key: "Enter", shiftKey: true });
    document.fire("keydown", null, { key: "z", metaKey: true });
    document.fire("keydown", null, { key: "a" });
    expect(messages("unframed:edit:key")).toEqual([
      { type: "unframed:edit:key", key: "v", shift: false, meta: false, ctrl: false },
      { type: "unframed:edit:key", key: "Enter", shift: true, meta: false, ctrl: false },
      { type: "unframed:edit:key", key: "z", shift: false, meta: true, ctrl: false },
    ]);
  });

  it("reports a selection, then the boxes once a frame when one moved, and nothing when none did", () => {
    const { element, send, flush, messages } = stubEditWindow();
    const el = element("hf-aaaa");
    send({ type: "unframed:edit:select", ids: ["hf-aaaa"] });
    expect(messages("unframed:edit:report")[0].elements).toEqual([expect.objectContaining({ id: "hf-aaaa", tag: "div", box: { x: 0, y: 0, w: 10, h: 10 } })]);
    flush();
    expect(messages("unframed:edit:boxes")).toEqual([{ type: "unframed:edit:boxes", boxes: { "hf-aaaa": { x: 0, y: 0, w: 10, h: 10 } } }]);
    flush();
    expect(messages("unframed:edit:boxes")).toHaveLength(1);
    el.rect = { left: 4, top: 0, width: 10, height: 10 };
    send({ type: "unframed:edit:select", ids: ["hf-aaaa"] });
    flush();
    expect(messages("unframed:edit:boxes").at(-1).boxes["hf-aaaa"]).toEqual({ x: 4, y: 0, w: 10, h: 10 });
  });

  it("reports the live animated properties of a motion's tweens on the element", () => {
    const tweens: unknown[] = [];
    const { element, send, messages } = stubEditWindow({
      timelines: {
        main: {
          getChildren: () => tweens,
        },
      },
    });
    const el = element("hf-aaaa");
    tweens.push({ targets: () => [el], vars: { opacity: 0.5, duration: 1, x: 40, backgroundColor: "#fff" } });
    send({ type: "unframed:edit:select", ids: ["hf-aaaa"] });
    expect(messages("unframed:edit:report")[0].elements[0].animated).toEqual(["opacity", "transform", "background-color"]);
  });

  it("answers the tree of elements under the body, and the element a point holds", () => {
    const { document, element, send, messages } = stubEditWindow();
    const card = element("hf-aaaa");
    element("hf-bbbb", { text: "Title", parent: card });
    card.add(new FakeElement("span"));
    document.body.add(new FakeElement("script"));
    send({ type: "unframed:edit:tree" });
    expect(messages("unframed:edit:tree")[0].nodes).toEqual([
      {
        id: "hf-aaaa",
        selector: '[data-hf-id="hf-aaaa"]',
        tag: "div",
        children: [
          { id: "hf-bbbb", selector: '[data-hf-id="hf-bbbb"]', tag: "div", children: [] },
          { id: null, selector: '[data-hf-id="hf-aaaa"] > span:nth-of-type(1)', tag: "span", children: [] },
        ],
      },
    ]);

    const picture = element("hf-cccc", { tag: "img", attrs: { src: "a.png" } });
    document.hit = picture;
    send({ type: "unframed:edit:hitTest", x: 3, y: 4 });
    expect(messages("unframed:edit:hit").at(-1)).toEqual({ type: "unframed:edit:hit", elementId: "hf-cccc", target: "src", box: { x: 0, y: 0, w: 10, h: 10 } });
    document.hit = card;
    send({ type: "unframed:edit:hitTest", x: 3, y: 4 });
    expect(messages("unframed:edit:hit").at(-1)).toEqual({ type: "unframed:edit:hit", elementId: null, target: null, box: null });
  });

  it("reports the scroll position once a frame, however many scroll events came before it", () => {
    const { win, fire, flush, messages } = stubEditWindow();
    win.scrollY = 120;
    fire("scroll");
    win.scrollY = 240;
    fire("scroll");
    fire("scroll");
    expect(messages("unframed:edit:scroll")).toEqual([]);
    flush();
    expect(messages("unframed:edit:scroll")).toEqual([{ type: "unframed:edit:scroll", x: 0, y: 240 }]);
    // A later scroll is reported in its own frame.
    win.scrollY = 300;
    fire("scroll");
    flush();
    expect(messages("unframed:edit:scroll").at(-1)).toEqual({ type: "unframed:edit:scroll", x: 0, y: 300 });
  });

  it("restores the scroll a hello carries at once when the document has loaded, and after the load otherwise", () => {
    const loaded = stubEditWindow();
    loaded.send({ type: "unframed:edit:hello", scroll: { x: 0, y: 512 } });
    expect(loaded.scrolls).toEqual([[0, 512]]);

    const loading = stubEditWindow({ loading: true });
    loading.send({ type: "unframed:edit:hello", scroll: { x: 0, y: 512 } });
    expect(loading.scrolls).toEqual([]);
    loading.fire("load");
    expect(loading.scrolls).toEqual([[0, 512]]);
    // A hello without a scroll leaves the position alone.
    loading.send({ type: "unframed:edit:hello" });
    expect(loading.scrolls).toEqual([[0, 512]]);
  });

  it("reports the selection again after a dial is set, so the field follows the dial", () => {
    const { element, send, messages } = stubEditWindow();
    element("hf-aaaa");
    send({ type: "unframed:edit:select", ids: ["hf-aaaa"] });
    const before = messages("unframed:edit:report").length;
    send({ type: "unframed:dials:set", values: { accent: "#000" } });
    expect(messages("unframed:edit:report").length).toBe(before + 1);
  });
});
