import { afterAll, describe, expect, it, vi } from "vitest";
import { gsap } from "gsap";
import { editBridgeSource } from "../../src/index.ts";

type Listener = (event: any) => void;

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
  fire(type: string, target: FakeElement | null, init: Record<string, unknown> = {}): boolean {
    let prevented = false;
    const event = { type, target, key: "", shiftKey: false, metaKey: false, ctrlKey: false, clientX: 0, clientY: 0, ...init, preventDefault: () => (prevented = true) };
    for (const each of [...this.listeners]) if (each.type === type) each.listener(event);
    return prevented;
  }
}

const ORIGIN = "http://localhost:18787";

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
  new Function("window", editBridgeSource())(win);
  const send = (data: unknown, from: { source?: unknown; origin?: string } = {}) => {
    for (const listener of listeners) listener({ source: from.source ?? parent, origin: from.origin ?? "http://127.0.0.1:5001", data });
  };
  const flush = () => {
    for (const frame of frames.splice(0)) frame();
  };
  const mode = (value: "edit" | "interact", locked: string[] = []) => send({ type: "unframed:edit:mode", mode: value, locked });
  const messages = (type: string) => posted.filter((entry) => entry.message.type === type).map((entry) => entry.message);
  const element = (id: string, options: { tag?: string; text?: string; attrs?: Record<string, string>; parent?: FakeElement } = {}) =>
    (options.parent ?? document.body).add(new FakeElement(options.tag ?? "div", { ...(options.text === undefined ? {} : { text: options.text }), attrs: { "data-hf-id": id, ...options.attrs } }));
  const runTimers = () => {
    for (const [timer, entry] of [...timers]) {
      timers.delete(timer);
      entry.callback();
    }
  };
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

describe("the motion's live tween report and transport keys (spec 21, task 19)", () => {
  it("reports each live tween's targets, timing, keyframes, animated properties and repeats after load, and after each dials apply once a frame", () => {
    const tweens: unknown[] = [];
    const { document, element, messages, fire, flush, win } = stubEditWindow({ timelines: { main: { getChildren: () => tweens } } });
    const el = element("hf-aaaa");
    tweens.push({
      targets: () => [el],
      startTime: () => 1,
      duration: () => 0.5,
      vars: { x: 40, opacity: 0, repeat: 2, yoyo: true, duration: 0.5, ease: "power1.out", keyframes: { "0%": { x: 0 }, "100%": { x: 40 } } },
    });
    fire("load");
    flush();
    const first = messages("unframed:edit:tweens");
    expect(first).toHaveLength(1);
    expect(first[0].tweens).toEqual([{ targets: ["hf-aaaa"], start: 1, duration: 0.5, keyframes: [0, 100], props: ["x", "opacity"], repeat: 2, yoyo: true }]);
    win.unframedDialsApplied();
    win.unframedDialsApplied();
    flush();
    expect(messages("unframed:edit:tweens")).toHaveLength(2);
    const bare = document.body.add(new FakeElement("span"));
    tweens.push({ targets: () => [bare], startTime: () => 0, duration: () => 1, vars: { y: 4 } });
    win.unframedDialsApplied();
    flush();
    expect(messages("unframed:edit:tweens").at(-1).tweens[1].targets).toEqual(["body > span:nth-of-type(1)"]);
  });

  it("forwards the transport keys from a motion in Edit mode, and not from a page", () => {
    const motion = stubEditWindow({ timelines: {} });
    const page = stubEditWindow();
    const motionEl = motion.element("hf-aaaa");
    const pageEl = page.element("hf-aaaa");
    motion.mode("edit");
    page.mode("edit");
    expect(motion.document.fire("keydown", motionEl, { key: " " })).toBe(true);
    motion.document.fire("keydown", motionEl, { key: "L", shiftKey: true });
    motion.document.fire("keydown", motionEl, { key: "ArrowLeft" });
    expect(motion.messages("unframed:edit:key")).toEqual([
      { type: "unframed:edit:key", key: " ", shift: false, meta: false, ctrl: false },
      { type: "unframed:edit:key", key: "L", shift: true, meta: false, ctrl: false },
      { type: "unframed:edit:key", key: "ArrowLeft", shift: false, meta: false, ctrl: false },
    ]);
    page.document.fire("keydown", pageEl, { key: " " });
    expect(page.messages("unframed:edit:key")).toEqual([]);
  });

  it("forwards none of the transport keys during an in-place text edit", () => {
    const { document, element, mode, send, messages } = stubEditWindow({ timelines: {} });
    const el = element("hf-aaaa", { text: "Hi" });
    mode("edit");
    send({ type: "unframed:edit:textEdit", id: "hf-aaaa" });
    expect(document.fire("keydown", el, { key: " " })).toBe(false);
    expect(document.fire("keydown", el, { key: "J" })).toBe(false);
    expect(messages("unframed:edit:key")).toEqual([]);
  });
});

describe("the tween patcher, against real GSAP (spec 21, task 20)", () => {
  afterAll(() => gsap.ticker.sleep());
  const setup = () => {
    const tl = gsap.timeline({ paused: true });
    const stub = stubEditWindow({ timelines: { main: tl } });
    return { tl, ...stub };
  };
  const at = (el: object) => ({ get x() { return Number((el as { x?: unknown }).x); }, get opacity() { return Number((el as { opacity?: unknown }).opacity); } });
  const tweenOn = (tl: ReturnType<typeof gsap.timeline>, property: string) =>
    tl.getChildren(false, true, false).find((tween) => property in (tween as { vars: object }).vars) as any;
  const patch = (selector: string, channels: string[], change: Record<string, unknown>) => ({ kind: "tween", selector, channels, change });

  it("sets a value on the one tween its channels name, and invalidates that tween alone", () => {
    const { tl, element, send } = setup();
    const el = element("hf-aaaa");
    const other = element("hf-bbbb");
    tl.to(el, { x: 40, duration: 1 }, 1);
    tl.to(other, { x: 10, duration: 1 }, 1);
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { values: { at: 1, props: { x: 80 } } })] });
    tl.seek(2, false);
    expect(at(el).x).toBe(80);
    expect(at(other).x).toBe(10);
    expect(tl.getChildren(false, true, false)).toHaveLength(2);
  });

  it("recreates an object-keyframe tween with the step changed, at the same start", () => {
    const { tl, element, send } = setup();
    const el = element("hf-aaaa");
    tl.to(el, { keyframes: { "0%": { x: 0 }, "100%": { x: 40 } }, duration: 1 }, 1);
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { values: { at: 0.5, props: { x: 20 } } })] });
    const [tween] = tl.getChildren(false, true, false) as any[];
    expect(tl.getChildren(false, true, false)).toHaveLength(1);
    expect(tween.startTime()).toBe(1);
    expect(tween.vars.keyframes["50%"]).toEqual({ x: 20 });
    tl.seek(1.5, false);
    expect(at(el).x).toBeCloseTo(20, 6);
  });

  it("recreates a tween with a new ease, the playback following the curve", () => {
    const { tl, element, send } = setup();
    const el = element("hf-aaaa");
    tl.to(el, { x: 40, duration: 1, ease: "none" }, 1);
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { ease: "power1.in" })] });
    const [tween] = tl.getChildren(false, true, false) as any[];
    expect(tween.vars.ease).toBe("power1.in");
    expect(tween.startTime()).toBe(1);
    tl.seek(1.5, false);
    expect(at(el).x).toBeCloseTo(10, 6);
  });

  it("recreates a staggered tween with the new spacing", () => {
    const { tl, element, send } = setup();
    const a = element("hf-aaaa");
    const b = element("hf-bbbb");
    tl.to([a, b], { x: 10, duration: 1, ease: "none", stagger: 0.1 }, 1);
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { stagger: 0.5 })] });
    const [tween] = tl.getChildren(false, true, false) as any[];
    expect(tween.vars.stagger).toBe(0.5);
    tl.seek(1.4, false);
    expect(at(b).x || 0).toBe(0);
    expect(at(a).x).toBeCloseTo(4, 6);
  });

  it("moves a tween to a new start and sets its duration, keeping it in its timeline", () => {
    const { tl, element, send } = setup();
    const el = element("hf-aaaa");
    tl.to(el, { x: 40, duration: 1, ease: "none" }, 1);
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { start: 2, duration: 0.5 })] });
    const [tween] = tl.getChildren(false, true, false) as any[];
    expect(tl.getChildren(false, true, false)).toHaveLength(1);
    expect(tween.startTime()).toBe(2);
    expect(tween.duration()).toBe(0.5);
    tl.seek(2.25, false);
    expect(at(el).x).toBeCloseTo(20, 6);
  });

  it("declines, silently and with nothing written, a relative or random value, a motion path, a tween it cannot find, two that match, and a move past another tween", () => {
    const { tl, element, send } = setup();
    const el = element("hf-aaaa");
    tl.to(el, { x: 40, duration: 1, ease: "none" }, 1);
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { values: { at: 1, props: { x: "+=10" } } })] });
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { values: { at: 1, props: { x: "random(0, 9)" } } })] });
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { values: { at: 1, props: { x: NaN } } })] });
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["opacity"], { values: { at: 1, props: { opacity: 0 } } })] });
    expect((tl.getChildren(false, true, false)[0] as any).vars.x).toBe(40);
    const motion = setup();
    const mel = motion.element("hf-aaaa");
    motion.tl.to(mel, { x: 40, motionPath: { path: [] }, duration: 1 }, 1);
    motion.send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["motionPath", "x"], { values: { at: 1, props: { x: 5 } } })] });
    expect((motion.tl.getChildren(false, true, false)[0] as any).vars.x).toBe(40);
    const twin = setup();
    const tel = twin.element("hf-aaaa");
    twin.tl.to(tel, { x: 40, duration: 1 }, 1);
    twin.tl.to(tel, { x: 60, duration: 1 }, 3);
    twin.send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { values: { at: 1, props: { x: 0 } } })] });
    expect(twin.tl.getChildren(false, true, false).map((t: any) => t.vars.x)).toEqual([40, 60]);
    const order = setup();
    const oel = order.element("hf-aaaa");
    order.tl.to(oel, { x: 40, duration: 1 }, 1);
    order.tl.to(oel, { x: 60, duration: 1 }, 3);
    order.send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { start: 4 })] });
    const starts = order.tl.getChildren(false, true, false).map((t: any) => t.startTime());
    expect(starts).toEqual([1, 3]);
  });

  it("seeks once for all the patches of one message", () => {
    const { tl, element, send } = setup();
    const el = element("hf-aaaa");
    tl.to(el, { x: 40, duration: 1 }, 1);
    tl.to(el, { opacity: 1, duration: 1 }, 1);
    const seek = vi.spyOn(tl, "seek");
    send({
      type: "unframed:edit:patch",
      patches: [patch("hf-aaaa", ["x"], { values: { at: 1, props: { x: 80 } } }), patch("hf-aaaa", ["opacity"], { values: { at: 1, props: { opacity: 0.5 } } })],
    });
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it("applies the held patches again after a dials apply rebuilds the timeline", () => {
    const { tl, element, send, win } = setup();
    const el = element("hf-aaaa");
    tl.to(el, { x: 40, duration: 1 }, 1);
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { values: { at: 1, props: { x: 80 } } })] });
    tl.clear();
    tl.to(el, { x: 40, duration: 1 }, 1);
    win.unframedDialsApplied();
    tl.seek(2, false);
    expect(at(el).x).toBe(80);
  });

  it("puts every touched tween back on a reset, and drops the held patches", () => {
    const { tl, element, send, win } = setup();
    const el = element("hf-aaaa");
    tl.to(el, { x: 40, duration: 1, ease: "none" }, 1);
    send({ type: "unframed:edit:patch", patches: [patch("hf-aaaa", ["x"], { ease: "power2.in" }), patch("hf-aaaa", ["x"], { values: { at: 1, props: { x: 80 } } })] });
    send({ type: "unframed:edit:reset" });
    const [tween] = tl.getChildren(false, true, false) as any[];
    expect(tween.vars.ease).toBe("none");
    expect(tween.vars.x).toBe(40);
    tl.clear();
    tl.to(el, { x: 40, duration: 1, ease: "none" }, 1);
    win.unframedDialsApplied();
    tl.seek(2, false);
    expect(at(el).x).toBe(40);
  });
});
