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
  /** The element's open shadow root, where a component instance keeps its markup (spec 20). */
  readonly shadowRoot?: { querySelector(selector: string): EditElement | null } | null;
  getRootNode?(): unknown;
  matches?(selector: string): boolean;
  readonly id?: string;
}

export interface EditEvent {
  readonly type: string;
  readonly target: EditElement | null;
  /** The path from the target out through shadow roots, innermost first (spec 20: board copies). */
  composedPath?(): ReadonlyArray<unknown>;
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
  querySelectorAll?(selector: string): ArrayLike<EditElement>;
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
  /** HyperFrames' player, when the page has one: the tween preview seeks it (spec 21). */
  __player?: { getTime?: () => number; seek?: (time: number) => void };
  /** Set by this bridge; the dials bridge calls it after each apply (spec 21). */
  unframedDialsApplied?: () => void;
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
    "duration", "ease", "delay", "repeat", "repeatDelay", "yoyo", "yoyoEase", "stagger", "paused", "parent", "lazy",
    "immediateRender", "overwrite", "callbackScope", "keyframes",
  ];
  const TRANSFORM = ["x", "y", "z", "scale", "scaleX", "scaleY", "scaleZ", "rotation", "rotationX", "rotationY", "rotationZ", "skewX", "skewY", "xPercent", "yPercent"];
  const KEYS_FORWARDED = ["v", "V", "i", "I", "Escape"];
  // A motion's transport keys, forwarded to the editor from the frame in Edit mode (spec 21). A page keeps them.
  const TRANSPORT_KEYS = [" ", "ArrowLeft", "ArrowRight", "j", "J", "k", "K", "l", "L", "m", "M", "o", "O"];

  const doc = win.document;
  // A board cell's host carries this attribute (the sheet helper sets it). Its shadow root holds one copy of the template.
  const CELL = "data-uf-cell";
  const cellOf = (el: EditElement): EditElement | null => {
    const root = el.getRootNode?.() as { host?: EditElement } | undefined;
    const host = root?.host;
    return host !== undefined && host.getAttribute(CELL) !== null ? host : null;
  };
  const isCopy = (el: EditElement): boolean => el.getAttribute("data-hf-id") !== null && cellOf(el) !== null;
  // The copy the person picked for each template id, kept while the copy is on the board.
  const picked = new Map<string, EditElement>();
  const copiesOf = (id: string): EditElement[] => {
    if (typeof doc.querySelectorAll !== "function") return [];
    const found: EditElement[] = [];
    for (const host of Array.from(doc.querySelectorAll("[" + CELL + "]"))) {
      const copy = host.shadowRoot?.querySelector('[data-hf-id="' + id + '"]');
      if (copy) found.push(copy);
    }
    return found;
  };
  // The copy an id shows in the frame: the one picked, else the first. Null when the id has no copies.
  const primaryOf = (id: string): EditElement | null => {
    const all = copiesOf(id);
    const kept = picked.get(id);
    if (kept !== undefined && all.includes(kept)) return kept;
    return all[0] ?? null;
  };
  // The innermost copy an event passed through, if it came from a board cell.
  const copyAt = (event: EditEvent): EditElement | null => {
    for (const node of event.composedPath?.() ?? []) {
      const el = node as EditElement;
      if (el.nodeType === 1 && isCopy(el)) return el;
    }
    return null;
  };
  const targetOf = (event: EditEvent): EditElement | null => copyAt(event) ?? event.target;
  let peer: string = typeof win.unframedEditPeer === "string" ? win.unframedEditPeer : win.location.origin;
  let listening = false;
  let locked: string[] = [];
  let hovered: EditElement | null = null;
  // The editor's Layers row under the pointer: outlined through the boxes, never echoed back.
  let external: EditElement | null = null;
  let selection: string[] = [];
  let frame: unknown = null;
  let last: Record<string, EditBox> = {};
  // The boxes of the copies of each targeted board element, as last sent.
  let lastCopies = "";
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
    if (cellOf(el) !== null) return id;
    return doc.querySelector('[data-hf-id="' + id + '"]') === el ? id : null;
  };

  const isInBody = (el: EditElement): boolean => {
    for (let e: EditElement | null = el; e; e = e.parentElement) if (e === doc.body) return true;
    return false;
  };

  const pickable = (el: EditElement | null): boolean =>
    el !== null && el.nodeType === 1 && (isCopy(el) || (el !== doc.body && isInBody(el) && !EXCLUDED.includes(el.tagName.toLowerCase())));

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
      const el = doc.querySelector(ID.test(key) ? '[data-hf-id="' + key + '"]' : key);
      // A board's template id shows as its copy, so the outline sits on the copy the person picked.
      if (el !== null && ID.test(key)) return primaryOf(key) ?? el;
      return el;
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

  // A copy's variant values, by variant name in the declaration's order (its cell's attributes). Null for anything else.
  const variantOf = (el: EditElement): Record<string, string> | null => {
    const host = cellOf(el);
    if (host === null) return null;
    const declaration = (host as unknown as { constructor: { declaration?: { variants?: Record<string, string[]> } } }).constructor.declaration;
    if (declaration?.variants === undefined) return null;
    const values: Record<string, string> = {};
    for (const name of Object.keys(declaration.variants)) values[name] = host.getAttribute(name) ?? "";
    return values;
  };

  // An instance's pinned component: its tag, sheet and declaration (the defined element's static fields), and the live value of each declared attribute (spec 20).
  const componentOf = (el: EditElement) => {
    const ctor = (el as unknown as { constructor: { declaration?: { tag: string; variants?: Record<string, string[]>; props?: Record<string, string> }; sheet?: unknown } }).constructor;
    const declaration = ctor?.declaration;
    if (declaration === undefined || typeof ctor.sheet !== "string") return undefined;
    const names = [...Object.keys(declaration.variants ?? {}), ...Object.keys(declaration.props ?? {})];
    return {
      tag: declaration.tag,
      sheet: ctor.sheet,
      declaration,
      attributes: Object.fromEntries(names.map((name) => [name, el.getAttribute(name)])),
    };
  };

  // A board copy's rules (spec 20): each rule of the sheet's component style that reaches the copy in its cell, with its declarations.
  // `unknown` marks a rule with `:has()`, which the bridge cannot test. The block is the index of the component style among the source's <style> elements, as spec 19 counts them.
  const RULE_HOST = /:host(?:\(((?:[^()]|\([^()]*\))*)\))?/g;
  const RULE_ATTRIBUTE = /\[\s*([A-Za-z][\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
  const reachesCopy = (host: EditElement, el: EditElement, selector: string): boolean | "unknown" => {
    if (/:has\(/.test(selector)) return "unknown";
    for (const part of selector.matchAll(RULE_HOST)) {
      for (const attribute of (part[1] ?? "").matchAll(RULE_ATTRIBUTE)) {
        const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? null;
        const actual = host.getAttribute(attribute[1]!);
        if (value === null ? actual === null : actual !== value) return false;
      }
    }
    const rest = selector.replace(RULE_HOST, " ").trim();
    if (rest === "" || el.matches === undefined) return false;
    try {
      return el.matches(rest);
    } catch {
      return false;
    }
  };
  const declarationsOf = (body: string) => {
    const found: Array<{ property: string; value: string; important: boolean }> = [];
    for (const part of body.split(";")) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      const property = part.slice(0, colon).trim().toLowerCase();
      const raw = part.slice(colon + 1).trim();
      const important = /!\s*important$/i.test(raw);
      const value = raw.replace(/!\s*important$/i, "").trim();
      if (property !== "" && value !== "") found.push({ property, value, important });
    }
    return found;
  };
  const sheetRulesOf = (el: EditElement) => {
    const host = cellOf(el);
    if (host === null || typeof doc.querySelectorAll !== "function") return undefined;
    // The kit's custom properties sit in a <style id="unframed-tokens"> the tokens script adds at run time; the source does not hold it.
    const styles = Array.from(doc.querySelectorAll("style")).filter((style) => style.id !== "unframed-tokens");
    const block = styles.findIndex((style) => style.getAttribute("data-uf-component-style") !== null);
    if (block < 0) return [];
    const css = (styles[block]!.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    const seen = new Map<string, number>();
    const found: Array<{ ref: { block: number; selector: string; occurrence: number }; declarations: Array<{ property: string; value: string; important: boolean }>; unknown: boolean }> = [];
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1]!.trim();
      if (selector === "" || selector.startsWith("@")) continue;
      const occurrence = seen.get(selector) ?? 0;
      seen.set(selector, occurrence + 1);
      const reaches = reachesCopy(host, el, selector);
      if (reaches === false) continue;
      found.push({ ref: { block, selector, occurrence }, declarations: declarationsOf(match[2]!), unknown: reaches === "unknown" });
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
      variant: variantOf(el),
      component: componentOf(el),
      sheetRules: sheetRulesOf(el),
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
      const copies: Record<string, EditBox[]> = {};
      for (const [key, el] of targets) {
        const box = boxOf(el);
        boxes[key] = box;
        const before = last[key];
        if (before === undefined || before.x !== box.x || before.y !== box.y || before.w !== box.w || before.h !== box.h) moved = true;
        if (isCopy(el)) copies[key] = copiesOf(key).map(boxOf);
      }
      if (moved) post({ type: "unframed:edit:boxes", boxes });
      last = boxes;
      const serialised = JSON.stringify(copies);
      if (serialised !== lastCopies) {
        lastCopies = serialised;
        post({ type: "unframed:edit:copies", copies });
      }
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

  const idsMatching = (selector: string): string[] => {
    if (typeof doc.querySelectorAll !== "function") return [];
    try {
      return Array.from(doc.querySelectorAll(selector)).flatMap((el) => {
        const id = validId(el);
        return id === null ? [] : [id];
      });
    } catch {
      // A selector the document cannot match (an invalid one) selects nothing.
      return [];
    }
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
    const el = hoverTarget(targetOf(event));
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
    const el = hoverTarget(targetOf(event));
    if (el !== null && isCopy(el)) picked.set(validId(el)!, el);
    // The press did not move keyboard focus (the bridge prevents it), so the frame takes it: Enter and Escape then reach the frame.
    if (win.focus) win.focus();
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

  // A field the page owns keeps its keys, in either mode.
  const typingIn = (event: EditEvent): boolean => {
    const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
    return target?.isContentEditable === true || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
  };

  const onKey = (event: EditEvent) => {
    if (!listening) {
      // Interact leaves the page's keys alone, but the mode keys and Escape still reach the editor (spec 18, Mode).
      if (KEYS_FORWARDED.includes(event.key) && !typingIn(event)) post({ type: "unframed:edit:key", key: event.key, shift: event.shiftKey === true, meta: event.metaKey === true, ctrl: event.ctrlKey === true });
      return;
    }
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
    // A motion also forwards its transport keys, so the editor's transport answers them from the frame.
    const transport = win.__timelines !== undefined && TRANSPORT_KEYS.includes(event.key);
    if (KEYS_FORWARDED.includes(event.key) || event.key === "Enter" || undo || transport) {
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

  // The live tweens of a motion: reported after load and after each dials apply, at most once a frame (spec 21).
  let tweenFrame: unknown = null;
  const keyframePercents = (vars: Record<string, unknown>): number[] => {
    const steps = vars.keyframes;
    if (Array.isArray(steps)) return steps.map((_, index) => (steps.length > 1 ? Math.round((index / (steps.length - 1)) * 100) : 0));
    if (typeof steps === "object" && steps !== null) return Object.keys(steps).map((key) => parseFloat(key)).filter((value) => Number.isFinite(value));
    return [];
  };
  // A report asked for before the composition's script has made its timelines is asked again, for a few seconds.
  let tweenWaits = 0;
  const reportTweens = () => {
    tweenFrame = null;
    const found: unknown[] = [];
    const timelines = win.__timelines;
    if (typeof timelines !== "object" || timelines === null) {
      if (tweenWaits < 50) {
        tweenWaits += 1;
        win.setTimeout(reportTweens, 100);
      }
      return;
    }
    tweenWaits = 0;
    for (const timeline of Object.values(timelines)) {
      const tl = timeline as { getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => unknown[] };
      if (typeof tl?.getChildren !== "function") continue;
      for (const tween of tl.getChildren(true, true, false) as Array<{ targets?: () => unknown[]; startTime?: () => number; duration?: () => number; vars?: Record<string, unknown> }>) {
        if (typeof tween.targets !== "function") continue;
        const vars = tween.vars ?? {};
        const targets = tween.targets().filter((target): target is EditElement => typeof target === "object" && target !== null && (target as EditElement).nodeType === 1);
        found.push({
          targets: targets.map((target) => keyOf(target)),
          start: tween.startTime?.() ?? 0,
          duration: tween.duration?.() ?? 0,
          keyframes: keyframePercents(vars),
          props: Object.keys(vars).filter((key) => !GSAP_KEYS.includes(key) && !/^on[A-Z]/.test(key)),
          repeat: typeof vars.repeat === "number" ? vars.repeat : 0,
          yoyo: vars.yoyo === true,
        });
      }
    }
    post({ type: "unframed:edit:tweens", tweens: found });
  };
  const scheduleTweens = () => {
    if (tweenFrame !== null) return;
    tweenFrame = win.requestAnimationFrame(reportTweens);
  };
  if (doc.readyState === "complete") scheduleTweens();
  else win.addEventListener("load", scheduleTweens);

  // ---- Tween patches (spec 21, the preview of a timeline edit before its commit) ----
  // Ported from HyperFrames Studio's gsapRuntimePatch, packages/studio/src/hooks/gsapRuntimePatch.ts
  // in HyperFrames 0.8.206 (https://github.com/heygen-com/hyperframes), Copyright 2026 HeyGen, Inc.,
  // licensed under the Apache License, Version 2.0 (THIRD_PARTY_NOTICES).
  // NOTICE: this part is changed by Unframed. Tweens are found by target and channels across
  // window.__timelines, never by index. A value is set and its tween invalidated alone. Object keyframes,
  // eases and staggers are recreated, since GSAP reads them only when a tween is made. A move is a remove
  // and an add. Held patches are applied again after each dials apply, and seeks are one per message.
  interface GsapTween {
    readonly parent: GsapTimeline | null;
    readonly vars: Record<string, unknown>;
    targets(): unknown[];
    startTime(): number;
    duration(value?: number): unknown;
    invalidate?(): void;
    kill(): void;
  }
  interface GsapTimeline {
    getChildren(nested: boolean, tweens: boolean, timelines: boolean): unknown[];
    to(targets: unknown[], vars: Record<string, unknown>, position: number): unknown;
    add(child: GsapTween, position: number): unknown;
    time(): number;
    seek(time: number, suppressEvents: boolean): unknown;
  }
  // The first value of each tween the preview changed, kept with its tween until a reset.
  interface TweenSlot {
    parent: GsapTimeline;
    targets: unknown[];
    start: number;
    duration: number;
    vars: Record<string, unknown>;
  }
  const RELATIVE = /^[+\-*/]=/;
  const touchedTweens = new Map<GsapTween, TweenSlot>();
  // The tween patches of the burst, by key. Applied again after every dials apply, until a reset.
  const heldTweens = new Map<string, Record<string, unknown>>();

  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  const finiteOrAbsent = (value: unknown): boolean => value === undefined || (typeof value === "number" && Number.isFinite(value));
  const staticValue = (value: unknown): boolean =>
    typeof value === "number" ? Number.isFinite(value) : typeof value === "string" && !RELATIVE.test(value) && !value.includes("random(");

  const timelinesOf = (): GsapTimeline[] => {
    const timelines = win.__timelines;
    if (typeof timelines !== "object" || timelines === null) return [];
    return Object.values(timelines).filter((timeline): timeline is GsapTimeline => typeof (timeline as GsapTimeline)?.getChildren === "function");
  };
  const allTweens = (): GsapTween[] =>
    timelinesOf()
      .flatMap((timeline) => timeline.getChildren(true, true, false) as GsapTween[])
      .filter((tween) => typeof tween.targets === "function");

  // The channels a tween animates, from its vars, its from-values and every keyframe step.
  const channelsOf = (vars: Record<string, unknown>): string[] => {
    const names = new Set<string>();
    const take = (source: unknown) => {
      if (!isRecord(source)) return;
      for (const key of Object.keys(source)) if (!GSAP_KEYS.includes(key) && key !== "startAt" && key !== "runBackwards" && !/^on[A-Z]/.test(key)) names.add(key);
    };
    take(vars);
    take(vars.startAt);
    const steps = Array.isArray(vars.keyframes) ? vars.keyframes : isRecord(vars.keyframes) ? Object.values(vars.keyframes) : [];
    for (const step of steps) take(step);
    return [...names].sort();
  };

  // The one tween on the element whose channels are exactly these. Zero or several: nothing is patched.
  const findTween = (selector: string, channels: string[]): GsapTween | null => {
    const target = resolveKey(selector);
    if (target === null) return null;
    const wanted = channels.join("|");
    const matches = allTweens().filter((tween) => tween.targets().includes(target) && channelsOf(tween.vars).join("|") === wanted);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  };

  // A move that would pass another tween on a shared element and channel changes an order the preview keeps.
  const orderFlips = (tween: GsapTween, start: number, channels: string[]): boolean => {
    const own = tween.targets();
    const at = tween.startTime();
    return allTweens().some((other) => {
      if (other === tween || !other.targets().some((target) => own.includes(target))) return false;
      if (!channelsOf(other.vars).some((channel) => channels.includes(channel))) return false;
      const otherStart = other.startTime();
      return (at - otherStart) * (start - otherStart) < 0;
    });
  };

  const copyVars = (vars: Record<string, unknown>): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...vars };
    const copyStep = (step: unknown): unknown => (isRecord(step) ? { ...step } : step);
    if (isRecord(vars.startAt)) copy.startAt = copyStep(vars.startAt);
    if (Array.isArray(vars.keyframes)) copy.keyframes = vars.keyframes.map(copyStep);
    else if (isRecord(vars.keyframes)) copy.keyframes = Object.fromEntries(Object.entries(vars.keyframes).map(([key, step]) => [key, copyStep(step)]));
    return copy;
  };

  // The keyframe step an array's index holds: the first step at 0, the last at 1, as the reading gives them.
  const arrayIndex = (steps: unknown[], at: number): number => {
    const pct = Math.round(at * 100);
    return steps.findIndex((_, index) => (steps.length > 1 ? Math.round((index / (steps.length - 1)) * 100) : 0) === pct);
  };
  // Where a value at a diamond lives: a holder object (to-vars at 1, from-vars at 0), an array step, or an object keyframe.
  const placeOf = (vars: Record<string, unknown>, at: number): "holder" | "array" | "object" | null => {
    if (Array.isArray(vars.keyframes)) return arrayIndex(vars.keyframes, at) === -1 ? null : "array";
    if (isRecord(vars.keyframes)) return "object";
    if (at === 1) return vars.runBackwards === true ? null : "holder";
    if (at === 0) return vars.runBackwards === true || isRecord(vars.startAt) ? "holder" : null;
    return null;
  };
  const writeAt = (vars: Record<string, unknown>, at: number, props: Record<string, unknown>): void => {
    if (Array.isArray(vars.keyframes)) {
      const step = vars.keyframes[arrayIndex(vars.keyframes, at)];
      if (isRecord(step)) Object.assign(step, props);
      return;
    }
    if (isRecord(vars.keyframes)) {
      const pct = Math.round(at * 100);
      const map = vars.keyframes;
      const key = Object.keys(map).find((each) => Math.abs(parseFloat(each) - pct) < 0.05) ?? pct + "%";
      map[key] = { ...(isRecord(map[key]) ? map[key] : {}), ...props };
      return;
    }
    const holder = at === 0 && vars.runBackwards !== true ? vars.startAt : vars;
    if (isRecord(holder)) Object.assign(holder, props);
  };

  const remember = (tween: GsapTween): TweenSlot => {
    const known = touchedTweens.get(tween);
    if (known !== undefined) return known;
    const slot: TweenSlot = { parent: tween.parent as GsapTimeline, targets: tween.targets(), start: tween.startTime(), duration: tween.duration() as number, vars: copyVars(tween.vars) };
    touchedTweens.set(tween, slot);
    return slot;
  };

  // One patch, applied to its tween. False when it declines (silently: the bar moves and the frame catches up at the commit).
  const applyTween = (patch: Record<string, unknown>): boolean => {
    const change = isRecord(patch.change) ? patch.change : {};
    const values = isRecord(change.values) ? change.values : null;
    const channels = Array.isArray(patch.channels) && patch.channels.every((each) => typeof each === "string") ? (patch.channels as string[]) : null;
    if (typeof patch.selector !== "string" || channels === null) return false;
    if (!finiteOrAbsent(change.start) || !finiteOrAbsent(change.duration) || !finiteOrAbsent(change.stagger)) return false;
    if (change.ease !== undefined && !(typeof change.ease === "string" && staticValue(change.ease))) return false;
    if (values !== null && (typeof values.at !== "number" || !Number.isFinite(values.at) || values.at < 0 || values.at > 1 || !isRecord(values.props) || !Object.values(values.props).every(staticValue))) return false;
    const rebuild = change.ease !== undefined || change.stagger !== undefined;
    if (values === null && change.start === undefined && change.duration === undefined && !rebuild) return false;
    const at = values !== null ? (values.at as number) : 0;
    const props = values !== null ? (values.props as Record<string, unknown>) : {};

    const tween = findTween(patch.selector, channels);
    if (tween === null || tween.parent === null) return false;
    const vars = tween.vars;
    if ("motionPath" in vars) return false;
    const place = values === null ? "holder" : placeOf(vars, at);
    if (place === null) return false;
    if (change.start !== undefined && orderFlips(tween, change.start as number, channels)) return false;

    const parent = tween.parent;
    const slot = remember(tween);
    const targets = tween.targets();
    const start = change.start !== undefined ? (change.start as number) : tween.startTime();
    if (rebuild || place === "object") {
      // GSAP compiles object keyframes, eases and staggers when a tween is made: recreate it at the same place.
      const next = copyVars(vars);
      if (values !== null) writeAt(next, at, props);
      if (change.ease !== undefined) next.ease = change.ease;
      if (change.stagger !== undefined) next.stagger = change.stagger;
      if (change.duration !== undefined) next.duration = change.duration;
      const before = new Set(parent.getChildren(false, true, false));
      tween.kill();
      parent.to(targets, next, start);
      const fresh = parent.getChildren(false, true, false).find((each) => !before.has(each)) as GsapTween | undefined;
      touchedTweens.delete(tween);
      if (fresh !== undefined) touchedTweens.set(fresh, slot);
      return true;
    }
    if (values !== null) {
      writeAt(vars, at, props);
      tween.invalidate?.();
    }
    if (change.start !== undefined) parent.add(tween, start);
    if (change.duration !== undefined) tween.duration(change.duration as number);
    return true;
  };

  const seekNow = (): void => {
    const player = win.__player;
    if (typeof player?.getTime === "function" && typeof player.seek === "function") {
      player.seek(player.getTime());
      return;
    }
    for (const timeline of timelinesOf()) timeline.seek(timeline.time(), false);
  };

  const holdKey = (patch: Record<string, unknown>): string => {
    const change = isRecord(patch.change) ? patch.change : {};
    const values = isRecord(change.values) ? change.values : null;
    return JSON.stringify([
      patch.selector,
      Array.isArray(patch.channels) ? [...patch.channels].sort() : [],
      Object.keys(change).sort(),
      values === null ? null : [values.at, isRecord(values.props) ? Object.keys(values.props).sort() : []],
    ]);
  };

  // A reset puts every touched tween back as it was first seen.
  const restoreTweens = (): void => {
    const slots = [...touchedTweens];
    touchedTweens.clear();
    for (const [tween, slot] of slots) {
      if (tween.parent !== null) tween.kill();
      slot.parent.to(slot.targets, { ...slot.vars, duration: slot.duration }, slot.start);
    }
    if (slots.length > 0) seekNow();
  };

  // The dials callback rebuilds the timeline, so the tweens are new: the held patches go on, one seek for the lot.
  win.unframedDialsApplied = () => {
    touchedTweens.clear();
    let applied = false;
    for (const patch of heldTweens.values()) applied = applyTween(patch) || applied;
    if (applied) seekNow();
    scheduleTweens();
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

  // Whether a stylesheet `!important` rule that matches the element sets the property (spec 18). Undefined where the document
  // keeps no style sheets, as a test stub does.
  const importantRuleWins = (el: EditElement, property: string): boolean | undefined => {
    const sheets = (doc as { styleSheets?: ArrayLike<{ cssRules: ArrayLike<unknown> }> }).styleSheets;
    if (sheets === undefined) return undefined;
    const matches = (selector: string): boolean => {
      try {
        return (el as unknown as { matches(selector: string): boolean }).matches(selector);
      } catch {
        return false;
      }
    };
    const walk = (rules: ArrayLike<unknown>): boolean =>
      Array.from(rules).some((rule) => {
        const styled = rule as { selectorText?: unknown; style?: { getPropertyPriority(name: string): string }; cssRules?: ArrayLike<unknown> };
        if (typeof styled.selectorText === "string" && styled.style !== undefined) {
          return styled.style.getPropertyPriority(property) === "important" && matches(styled.selectorText);
        }
        return styled.cssRules !== undefined && walk(styled.cssRules);
      });
    return Array.from(sheets).some((sheet) => {
      try {
        return walk(sheet.cssRules);
      } catch {
        // A sheet from another origin keeps its rules to itself.
        return false;
      }
    });
  };

  // Whether a style value, as the browser would show it inline, is what the computed style became. In a browser the
  // `!important` rules decide; a value that changes nothing on screen is not overridden by itself.
  const overriddenBy = (el: EditElement, property: string, value: string, before: string): boolean => {
    const important = importantRuleWins(el, property);
    if (important !== undefined) return important;
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
        } else if (el.style.getPropertyValue("display") === "none" && el.style.getPropertyPriority("display") === "important") {
          // A hide the source carries is no preview's to restore, so the show takes its declaration out.
          el.style.removeProperty("display");
        }
      }
      flags.set(el, flags.get(el) === true);
    } else if (patch.type === "attribute" && typeof patch.name === "string") {
      touchAttribute(el, patch.name);
      if (typeof patch.value === "string") el.setAttribute(patch.name, patch.value);
      else el.removeAttribute(patch.name);
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

  // A component sheet's declaration, as its own document carries it (spec 20). Null in a page or a motion.
  const declarationOf = (): unknown => {
    const script = doc.querySelector('script[data-uf-component]');
    if (script === null || script.textContent === null) return null;
    try {
      return JSON.parse(script.textContent);
    } catch {
      return null;
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
    } else if (type === "unframed:edit:tweens") {
      // The editor asks again once a document is shown: a report queued while it was hidden may never have run (spec 21).
      tweenWaits = 0;
      win.setTimeout(reportTweens, 0);
    } else if (type === "unframed:edit:mode") {
      locked = Array.isArray(data.locked) ? data.locked.filter((id): id is string => typeof id === "string") : [];
      listen(data.mode === "edit");
    } else if (type === "unframed:edit:select") {
      selection = Array.isArray(data.ids) ? data.ids.filter((id): id is string => typeof id === "string") : [];
      reportSelection();
    } else if (type === "unframed:edit:selectMatching" && typeof data.selector === "string") {
      // The elements a style rule's selector matches, with an id each, answered for the editor to select (spec 19, Off-token values).
      post({ type: "unframed:edit:matched", ids: idsMatching(data.selector) });
    } else if (type === "unframed:edit:hover") {
      external = typeof data.id === "string" ? resolveKey(data.id) : null;
      schedule();
    } else if (type === "unframed:edit:patch") {
      const flags = new Map<EditElement, boolean>();
      let tweened = false;
      for (const patch of Array.isArray(data.patches) ? data.patches : []) {
        if (typeof patch !== "object" || patch === null) continue;
        const record = patch as Record<string, unknown>;
        if (record.kind === "tween") {
          heldTweens.set(holdKey(record), record);
          tweened = applyTween(record) || tweened;
        } else applyPatch(record, flags);
      }
      if (tweened) seekNow();
      const elements = Array.from(flags.keys()).map((el) => {
        const id = validId(el);
        const shown = id === null || cellOf(el) !== null ? el : (primaryOf(id) ?? el);
        return { ...reportOf(shown), overridden: flags.get(el) === true };
      });
      post({ type: "unframed:edit:report", elements, families: familiesOf() });
      last = {};
      schedule();
    } else if (type === "unframed:edit:reset") {
      for (const slots of originals.values()) for (const restore of slots.values()) restore();
      originals.clear();
      heldTweens.clear();
      restoreTweens();
    } else if (type === "unframed:edit:textEdit" && typeof data.id === "string") {
      const held = pendingText !== null && pendingText.id === data.id ? pendingText : null;
      if (held !== null) {
        win.clearTimeout(held.timer);
        pendingText = null;
      }
      beginEdit(data.id);
      if (held !== null) replay(held.keys);
    } else if (type === "unframed:edit:tree") {
      post({ type: "unframed:edit:tree", nodes: Array.from(doc.body.children).filter(pickable).map(treeOf), declaration: declarationOf() });
    } else if (type === "unframed:edit:hitTest" && typeof data.x === "number" && typeof data.y === "number") {
      post({ type: "unframed:edit:hit", ...hitAt(data.x, data.y) });
    }
  });

  doc.addEventListener("keydown", onKey, true);
  post({ type: "unframed:edit:ready" });
}

/** `unframed-edit.js`, as the engine writes it beside the dials bridge. */
export const editBridgeSource = (): string =>
  [
    "/* unframed-edit.js: generated by Unframed and rewritten on every write. Do not edit it here: changes are lost. */",
    `(${installEditBridge.toString()})(window);`,
    "",
  ].join("\n");
