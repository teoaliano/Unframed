/**
 * The edit bridge (spec 18): `unframed-edit.js`, which the dials bridge loads into an artifact
 * the first time the editor says `unframed:edit:hello`. It reports hovers, picks, element
 * reports and boxes to the editor, applies preview patches, and draws nothing: the editor draws
 * the outlines. The shipped file is this function's source text, so nothing inside it may refer
 * to anything outside it.
 */

export type EditBox = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export interface EditStyle {
  getPropertyValue(name: string): string;
  getPropertyPriority(name: string): string;
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): string;
}

export interface EditElement {
  readonly tagName: string;
  readonly nodeType: number;
  readonly parentElement: EditElement | null;
  readonly children: ArrayLike<EditElement>;
  readonly childNodes: ArrayLike<{ readonly nodeType: number }>;
  textContent: string | null;
  readonly style: EditStyle;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
  focus?(): void;
  blur?(): void;
}

export interface EditEvent {
  readonly type: string;
  readonly target: EditElement | null;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  preventDefault(): void;
}

export interface EditDocument {
  readonly body: EditElement;
  readonly visibilityState: string;
  readonly readyState: string;
  addEventListener(type: string, listener: (event: EditEvent) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: EditEvent) => void, capture: boolean): void;
  querySelector(selector: string): EditElement | null;
  elementFromPoint(x: number, y: number): EditElement | null;
  createElement(tag: string): EditElement;
  createRange?(): { selectNodeContents(node: EditElement): void; collapse?(toEnd: boolean): void };
}

/** The window the edit bridge runs against: a browser's, or a test's stub. */
export interface EditWindow {
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void };
  readonly location: { readonly origin: string };
  readonly document: EditDocument;
  readonly console: { error(...args: unknown[]): void };
  addEventListener(type: "message", listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
  addEventListener(type: "load" | "scroll", listener: () => void): void;
  readonly scrollX: number;
  readonly scrollY: number;
  scrollTo(x: number, y: number): void;
  getComputedStyle(element: EditElement): { getPropertyValue(name: string): string };
  requestAnimationFrame(callback: () => void): unknown;
  focus?(): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  getSelection?(): { removeAllRanges(): void; addRange(range: unknown): void } | null;
  /** Set by the dials bridge before it loads this file: the origin that said hello. */
  unframedEditPeer?: unknown;
  /** HyperFrames' GSAP timelines by name, in a motion. */
  __timelines?: unknown;
}

/**
 * The bridge: runs the edit protocol on `window`. Self-contained on purpose, like `dialRules`:
 * the shipped file is this function's source text.
 */
export function installEditBridge(win: EditWindow): void {
  const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const ID = /^[A-Za-z0-9_-]+$/;
  // The style properties the editor's Design tab reads. Mirrors DESIGN_FIELDS' properties (spec 18).
  const PROPERTIES = [
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "color",
    "background-color", "background-image", "border-width", "border-style", "border-color", "border-radius",
    "opacity", "box-shadow", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "gap", "display", "flex-direction",
    "align-items", "justify-content", "flex-wrap",
  ];
  // Elements a pointer or a Layers row never reaches, and the ones the source tree leaves out.
  const EXCLUDED = ["script", "style", "template", "meta", "link", "noscript", "base", "head", "html", "body"];
  const GSAP_KEYS = [
    "duration", "ease", "delay", "repeat", "repeatDelay", "yoyo", "yoyoEase", "stagger", "paused",
    "immediateRender", "overwrite", "callbackScope", "keyframes",
  ];
  const TRANSFORM = ["x", "y", "z", "scale", "scaleX", "scaleY", "scaleZ", "rotation", "rotationX", "rotationY", "rotationZ", "skewX", "skewY", "xPercent", "yPercent"];
  const KEYS_FORWARDED = ["v", "V", "i", "I", "Escape"];

  const doc = win.document;
  let peer: string = typeof win.unframedEditPeer === "string" ? win.unframedEditPeer : win.location.origin;
  let listening = false;
  let locked: string[] = [];
  let hovered: EditElement | null = null;
  // The editor's Layers row under the pointer: outlined through the boxes, never echoed back.
  let external: EditElement | null = null;
  let selection: string[] = [];
  let frame: unknown = null;
  let last: Record<string, EditBox> = {};
  let editing: { el: EditElement; id: string; original: string | null } | null = null;
  // The keys typed while a double-click's text edit waits for the editor's answer. They are held, not forwarded.
  type HeldKey = { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };
  let pendingText: { id: string; keys: HeldKey[]; timer: unknown } | null = null;
  const TEXT_ANSWER_MS = 1000;
  // The first value of every property a patch touched, per element, as a function that puts it back.
  const originals = new Map<EditElement, Map<string, () => void>>();

  const post = (message: Record<string, unknown>) => {
    try {
      win.parent.postMessage(message, peer);
    } catch (error) {
      win.console.error("[unframed] could not reach the editor", error);
    }
  };

  // The document's scroll, reported at most once a frame, so the editor keeps it for the swap (spec 18, The swap).
  let scrolling: unknown = null;
  win.addEventListener("scroll", () => {
    if (scrolling !== null) return;
    scrolling = win.requestAnimationFrame(() => {
      scrolling = null;
      post({ type: "unframed:edit:scroll", x: win.scrollX, y: win.scrollY });
    });
  });

  // A swapped-in document restores the scroll its predecessor had, once it has loaded.
  const restoreScroll = (x: unknown, y: unknown) => {
    if (typeof x !== "number" || typeof y !== "number") return;
    const restore = () => win.scrollTo(x, y);
    if (doc.readyState === "complete") restore();
    else win.addEventListener("load", restore);
  };

  const validId = (el: EditElement): string | null => {
    const id = el.getAttribute("data-hf-id");
    if (id === null || !ID.test(id)) return null;
    return doc.querySelector('[data-hf-id="' + id + '"]') === el ? id : null;
  };

  const isInBody = (el: EditElement): boolean => {
    for (let e: EditElement | null = el; e; e = e.parentElement) if (e === doc.body) return true;
    return false;
  };

  const pickable = (el: EditElement | null): boolean =>
    el !== null && el.nodeType === 1 && el !== doc.body && isInBody(el) && !EXCLUDED.includes(el.tagName.toLowerCase());

  const isLocked = (el: EditElement): boolean => {
    for (let e: EditElement | null = el; e; e = e.parentElement) {
      const id = validId(e);
      if (id !== null && locked.includes(id)) return true;
    }
    return false;
  };

  const selectorOf = (el: EditElement): string => {
    const own = validId(el);
    if (own !== null) return '[data-hf-id="' + own + '"]';
    const steps: string[] = [];
    let e: EditElement | null = el;
    while (e && e !== doc.body && validId(e) === null) {
      const parent: EditElement | null = e.parentElement;
      let index = 1;
      if (parent) for (const sibling of Array.from(parent.children)) {
        if (sibling === e) break;
        if (sibling.tagName === e.tagName) index++;
      }
      steps.unshift(e.tagName.toLowerCase() + ":nth-of-type(" + index + ")");
      e = parent;
    }
    const base = e && e !== doc.body ? '[data-hf-id="' + validId(e) + '"]' : "body";
    return [base].concat(steps).join(" > ");
  };

  const keyOf = (el: EditElement): string => validId(el) ?? selectorOf(el);
  // A selection key is an element id, or a live selector for a runtime element.
  const resolveKey = (key: string): EditElement | null => {
    try {
      return doc.querySelector(ID.test(key) ? '[data-hf-id="' + key + '"]' : key);
    } catch {
      return null;
    }
  };

  const boxOf = (el: EditElement): EditBox => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  const textOnly = (el: EditElement): boolean => el.childNodes.length > 0 && Array.from(el.childNodes).every((node) => node.nodeType === 3 || node.nodeType === 8);

  const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

  const animatedOf = (el: EditElement): string[] => {
    const found: string[] = [];
    const timelines = win.__timelines;
    if (typeof timelines !== "object" || timelines === null) return found;
    for (const timeline of Object.values(timelines)) {
      const tl = timeline as { getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => unknown[] };
      if (typeof tl?.getChildren !== "function") continue;
      for (const tween of tl.getChildren(true, true, false) as Array<{ targets?: () => unknown[]; vars?: Record<string, unknown> }>) {
        if (typeof tween.targets !== "function" || !tween.targets().includes(el)) continue;
        for (const key of Object.keys(tween.vars ?? {})) {
          if (GSAP_KEYS.includes(key) || /^on[A-Z]/.test(key)) continue;
          const name = TRANSFORM.includes(key) ? "transform" : key === "autoAlpha" ? "opacity" : kebab(key);
          if (!found.includes(name)) found.push(name);
        }
      }
    }
    return found;
  };

  const reportOf = (el: EditElement) => {
    const style = win.getComputedStyle(el);
    const inline: Record<string, string | null> = {};
    const computed: Record<string, string> = {};
    for (const property of PROPERTIES) {
      const value = el.style.getPropertyValue(property);
      inline[property] = value === "" ? null : value;
      computed[property] = style.getPropertyValue(property);
    }
    const tag = el.tagName.toLowerCase();
    return {
      id: validId(el),
      selector: selectorOf(el),
      tag,
      box: boxOf(el),
      text: textOnly(el) ? el.textContent : null,
      inline,
      computed,
      src: tag === "img" ? el.getAttribute("src") : null,
      animated: animatedOf(el),
    };
  };

  const hoverTarget = (target: EditElement | null): EditElement | null => {
    let el: EditElement | null = target;
    while (el && !pickable(el)) el = el.parentElement;
    if (el === null || isLocked(el)) return null;
    return el;
  };

  const schedule = () => {
    if (frame !== null || current().length === 0) return;
    frame = win.requestAnimationFrame(tick);
  };

  const current = (): Array<[string, EditElement]> => {
    const found: Array<[string, EditElement]> = [];
    const add = (el: EditElement | null) => {
      if (el !== null && !found.some((entry) => entry[1] === el)) found.push([keyOf(el), el]);
    };
    add(hovered);
    add(external);
    for (const key of selection) add(resolveKey(key));
    return found;
  };

  // Boxes follow: compared once per frame while anything is hovered or selected, sent when one moved.
  const tick = () => {
    frame = null;
    const targets = current();
    if (targets.length === 0) return;
    if (doc.visibilityState !== "hidden") {
      const boxes: Record<string, EditBox> = {};
      let moved = false;
      for (const [key, el] of targets) {
        const box = boxOf(el);
        boxes[key] = box;
        const before = last[key];
        if (before === undefined || before.x !== box.x || before.y !== box.y || before.w !== box.w || before.h !== box.h) moved = true;
      }
      if (moved) post({ type: "unframed:edit:boxes", boxes });
      last = boxes;
    }
    schedule();
  };

  // The first family of each element's computed font, unquoted: the families the Font field offers.
  const familiesOf = (): string[] => {
    const found: string[] = [];
    const walk = (el: EditElement) => {
      const first = win.getComputedStyle(el).getPropertyValue("font-family").split(",")[0]!.trim().replace(/^["']|["']$/g, "");
      if (first !== "" && !found.includes(first)) found.push(first);
      for (const child of Array.from(el.children)) if (pickable(child)) walk(child);
    };
    walk(doc.body);
    return found;
  };

  const reportSelection = () => {
    const elements: Array<ReturnType<typeof reportOf>> = [];
    for (const key of selection) {
      const el = resolveKey(key);
      if (el !== null) elements.push(reportOf(el));
    }
    post({ type: "unframed:edit:report", elements, families: familiesOf() });
    last = {};
    schedule();
  };

  const onMove = (event: EditEvent) => {
    if (!listening || editing !== null) return;
    const el = hoverTarget(event.target);
    if (el === hovered) return;
    hovered = el;
    post({ type: "unframed:edit:hover", element: el === null ? null : reportOf(el) });
    schedule();
  };

  // Presses, drags and submits never reach the page's own default action in Edit mode.
  const block = (event: EditEvent) => {
    if (!listening || (editing !== null && event.target === editing.el)) return;
    event.preventDefault();
  };

  const onClick = (event: EditEvent) => {
    if (!listening) return;
    if (editing !== null && event.target === editing.el) return;
    event.preventDefault();
    const el = hoverTarget(event.target);
    post({ type: "unframed:edit:pick", element: el === null ? null : reportOf(el), additive: event.shiftKey === true });
  };

  const onDoubleClick = (event: EditEvent) => {
    if (!listening || editing !== null) return;
    const el = hoverTarget(event.target);
    const id = el === null ? null : validId(el);
    if (el === null || id === null || !textOnly(el)) return;
    event.preventDefault();
    // The press did not move keyboard focus (the bridge prevents it), so the frame takes the focus here: keys typed now reach the frame.
    if (win.focus) win.focus();
    if (pendingText !== null) win.clearTimeout(pendingText.timer);
    const pending: { id: string; keys: HeldKey[]; timer: unknown } = { id, keys: [], timer: null };
    pending.timer = win.setTimeout(() => {
      // No answer in time counts as a refusal: the held keys are dropped, never sent late.
      if (pendingText === pending) pendingText = null;
    }, TEXT_ANSWER_MS);
    pendingText = pending;
    post({ type: "unframed:edit:textStart", id });
  };

  const endEdit = (save: boolean) => {
    if (editing === null) return;
    const { el, id } = editing;
    const text = el.textContent;
    editing = null;
    el.removeAttribute("contenteditable");
    if (el.removeEventListener) el.removeEventListener("blur", onBlur);
    if (save) post({ type: "unframed:edit:text", id, text });
  };

  const onBlur = () => endEdit(true);

  const beginEdit = (id: string) => {
    const el = doc.querySelector('[data-hf-id="' + id + '"]');
    if (el === null || validId(el) !== id || !textOnly(el) || isLocked(el)) return;
    // The text as the source gave it, so a reset puts it back even after a saved edit.
    touch(el, "text", () => {
      const value = el.textContent;
      return () => {
        el.textContent = value;
      };
    });
    editing = { el, id, original: el.textContent };
    el.setAttribute("contenteditable", "plaintext-only");
    if (el.addEventListener) el.addEventListener("blur", onBlur);
    selectText(el, false);
    if (el.focus) el.focus();
  };

  /** Selects an element's whole text, or puts the caret at its end. */
  const selectText = (el: EditElement, atEnd: boolean) => {
    if (!doc.createRange || !win.getSelection) return;
    const range = doc.createRange();
    range.selectNodeContents(el);
    if (atEnd && range.collapse) range.collapse(false);
    const selected = win.getSelection();
    if (selected) {
      selected.removeAllRanges();
      selected.addRange(range);
    }
  };

  /** Applies the keys held during a pending edit to its text, in order, as typing would: a letter replaces the selection, Backspace removes it, Enter ends the edit, Escape puts the original back. */
  const replay = (keys: HeldKey[]) => {
    const active = editing;
    if (active === null || keys.length === 0) return;
    const el = active.el;
    let text = el.textContent ?? "";
    let whole = true; // the selection still covers all the text
    for (const held of keys) {
      if (held.key === "Escape") {
        el.textContent = active.original;
        endEdit(false);
        return;
      }
      if (held.key === "Enter" && !held.shiftKey) {
        el.textContent = text;
        endEdit(true);
        return;
      }
      if (held.metaKey || held.ctrlKey) continue;
      if (held.key === "Backspace") text = whole ? "" : text.slice(0, -1);
      else if (held.key.length === 1) text = (whole ? "" : text) + held.key;
      else continue;
      whole = false;
    }
    el.textContent = text;
    selectText(el, true);
  };

  const onKey = (event: EditEvent) => {
    if (!listening) return;
    if (editing === null && pendingText !== null) {
      event.preventDefault();
      pendingText.keys.push({ key: event.key, shiftKey: event.shiftKey === true, metaKey: event.metaKey === true, ctrlKey: event.ctrlKey === true });
      return;
    }
    if (editing !== null) {
      // While a text edit runs only Esc and Enter are the bridge's; every other key is the text's.
      if (event.key === "Escape") {
        event.preventDefault();
        editing.el.textContent = editing.original;
        endEdit(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        // A text edit holds one run of text, so Shift+Enter inserts nothing and ends nothing.
        if (event.shiftKey) return;
        const el = editing.el;
        endEdit(true);
        if (el.blur) el.blur();
      }
      return;
    }
    event.preventDefault();
    const undo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";
    if (KEYS_FORWARDED.includes(event.key) || (event.key === "Enter" && event.shiftKey) || undo) {
      post({ type: "unframed:edit:key", key: event.key, shift: event.shiftKey === true, meta: event.metaKey === true, ctrl: event.ctrlKey === true });
    }
  };

  const LISTENERS: Array<[string, (event: EditEvent) => void]> = [
    ["pointermove", onMove],
    ["mousedown", block],
    ["pointerdown", block],
    ["dragstart", block],
    ["submit", block],
    ["click", onClick],
    ["dblclick", onDoubleClick],
    ["keydown", onKey],
  ];

  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    if (!on && pendingText !== null) {
      win.clearTimeout(pendingText.timer);
      pendingText = null;
    }
    for (const [type, handler] of LISTENERS) {
      if (on) doc.addEventListener(type, handler, true);
      else doc.removeEventListener(type, handler, true);
    }
    if (!on && hovered !== null) {
      hovered = null;
      post({ type: "unframed:edit:hover", element: null });
    }
  };

  // The first value of each touched property is kept once; reset puts every one back.
  const touch = (el: EditElement, key: string, capture: () => () => void) => {
    let slots = originals.get(el);
    if (slots === undefined) {
      slots = new Map();
      originals.set(el, slots);
    }
    if (!slots.has(key)) slots.set(key, capture());
  };

  const touchStyle = (el: EditElement, property: string) =>
    touch(el, "style:" + property, () => {
      const value = el.style.getPropertyValue(property);
      const priority = el.style.getPropertyPriority(property);
      return () => {
        if (value === "") el.style.removeProperty(property);
        else el.style.setProperty(property, value, priority);
      };
    });

  const touchAttribute = (el: EditElement, name: string) =>
    touch(el, "attr:" + name, () => {
      const value = el.getAttribute(name);
      return () => {
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
      };
    });

  const byId = (id: string): EditElement | null => {
    const el = doc.querySelector('[data-hf-id="' + id + '"]');
    return el !== null && validId(el) === id ? el : null;
  };

  // Whether a style value, as the browser would show it inline, is what the computed style became.
  const overriddenBy = (el: EditElement, property: string, value: string, before: string): boolean => {
    const after = win.getComputedStyle(el).getPropertyValue(property);
    const probe = doc.createElement("i");
    probe.style.setProperty(property, value);
    return after === before && after !== probe.style.getPropertyValue(property);
  };

  const applyPatch = (patch: Record<string, unknown>, flags: Map<EditElement, boolean>) => {
    const el = typeof patch.elementId === "string" ? byId(patch.elementId) : null;
    if (el === null) return;
    if (patch.type === "style" && typeof patch.property === "string") {
      const property = patch.property;
      const value = typeof patch.value === "string" ? patch.value : null;
      const before = win.getComputedStyle(el).getPropertyValue(property);
      touchStyle(el, property);
      if (value === null) el.style.removeProperty(property);
      else el.style.setProperty(property, value);
      const overridden = value !== null && overriddenBy(el, property, value, before);
      flags.set(el, flags.get(el) === true || overridden);
    } else if (patch.type === "text" && typeof patch.text === "string") {
      touch(el, "text", () => {
        const value = el.textContent;
        return () => {
          el.textContent = value;
        };
      });
      el.textContent = patch.text;
      flags.set(el, flags.get(el) === true);
    } else if (patch.type === "hide" && typeof patch.hidden === "boolean") {
      if (patch.hidden) {
        touchStyle(el, "display");
        el.style.setProperty("display", "none", "important");
      } else {
        const restore = originals.get(el)?.get("style:display");
        if (restore !== undefined) {
          restore();
          originals.get(el)?.delete("style:display");
        }
      }
      flags.set(el, flags.get(el) === true);
    } else if (patch.type === "image" && typeof patch.file === "string") {
      if (patch.target === "background") {
        touchStyle(el, "background-image");
        el.style.setProperty("background-image", 'url("' + patch.file + '")');
      } else {
        touchAttribute(el, "src");
        touchAttribute(el, "srcset");
        touchAttribute(el, "sizes");
        el.setAttribute("src", patch.file);
        el.removeAttribute("srcset");
        el.removeAttribute("sizes");
      }
      flags.set(el, flags.get(el) === true);
    }
  };

  const treeOf = (el: EditElement): { id: string | null; selector: string; tag: string; children: unknown[] } => ({
    id: validId(el),
    selector: selectorOf(el),
    tag: el.tagName.toLowerCase(),
    children: Array.from(el.children).filter(pickable).map(treeOf),
  });

  // The element under a point that holds an image, or a background image, walking up to the first one.
  const hitAt = (x: number, y: number) => {
    let el: EditElement | null = doc.elementFromPoint(x, y);
    while (el && el !== doc.body) {
      const tag = el.tagName.toLowerCase();
      const background = win.getComputedStyle(el).getPropertyValue("background-image");
      if (tag === "img" || (background !== "" && background !== "none")) {
        const id = validId(el);
        if (id === null || isLocked(el)) return { elementId: null, target: null, box: null };
        return { elementId: id, target: tag === "img" ? "src" : "background", box: boxOf(el) };
      }
      el = el.parentElement;
    }
    return { elementId: null, target: null, box: null };
  };

  win.addEventListener("message", (event) => {
    if (event.source !== win.parent) return;
    if (event.origin !== win.location.origin && !LOOPBACK.test(event.origin)) return;
    const data = event.data as Record<string, unknown> | null;
    if (typeof data !== "object" || data === null || typeof data.type !== "string") return;
    const type = data.type;
    if (type === "unframed:dials:set") {
      // The dials bridge has applied the values: report the selection again so the fields follow.
      if (selection.length > 0) reportSelection();
      return;
    }
    if (!type.startsWith("unframed:edit:")) return;
    peer = event.origin;
    if (type === "unframed:edit:hello") {
      if (typeof data.scroll === "object" && data.scroll !== null) {
        const at = data.scroll as { x?: unknown; y?: unknown };
        restoreScroll(at.x, at.y);
      }
      post({ type: "unframed:edit:ready" });
    } else if (type === "unframed:edit:mode") {
      locked = Array.isArray(data.locked) ? data.locked.filter((id): id is string => typeof id === "string") : [];
      listen(data.mode === "edit");
    } else if (type === "unframed:edit:select") {
      selection = Array.isArray(data.ids) ? data.ids.filter((id): id is string => typeof id === "string") : [];
      reportSelection();
    } else if (type === "unframed:edit:hover") {
      external = typeof data.id === "string" ? resolveKey(data.id) : null;
      schedule();
    } else if (type === "unframed:edit:patch") {
      const flags = new Map<EditElement, boolean>();
      for (const patch of Array.isArray(data.patches) ? data.patches : []) {
        if (typeof patch === "object" && patch !== null) applyPatch(patch as Record<string, unknown>, flags);
      }
      const elements = Array.from(flags.keys()).map((el) => ({ ...reportOf(el), overridden: flags.get(el) === true }));
      post({ type: "unframed:edit:report", elements, families: familiesOf() });
      last = {};
      schedule();
    } else if (type === "unframed:edit:reset") {
      for (const slots of originals.values()) for (const restore of slots.values()) restore();
      originals.clear();
    } else if (type === "unframed:edit:textEdit" && typeof data.id === "string") {
      const held = pendingText !== null && pendingText.id === data.id ? pendingText : null;
      if (held !== null) {
        win.clearTimeout(held.timer);
        pendingText = null;
      }
      beginEdit(data.id);
      if (held !== null) replay(held.keys);
    } else if (type === "unframed:edit:tree") {
      post({ type: "unframed:edit:tree", nodes: Array.from(doc.body.children).filter(pickable).map(treeOf) });
    } else if (type === "unframed:edit:hitTest" && typeof data.x === "number" && typeof data.y === "number") {
      post({ type: "unframed:edit:hit", ...hitAt(data.x, data.y) });
    }
  });

  post({ type: "unframed:edit:ready" });
}

/** `unframed-edit.js`, as the engine writes it beside the dials bridge. */
export const editBridgeSource = (): string =>
  [
    "/* unframed-edit.js: generated by Unframed and rewritten on every write. Do not edit it here: changes are lost. */",
    `(${installEditBridge.toString()})(window);`,
    "",
  ].join("\n");
