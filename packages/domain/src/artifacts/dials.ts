/**
 * Dials (spec 09): the parameters an artifact declares with `unframed.dials(name, config,
 * apply)`, in the shorthand the agent writes. Normalising, default values and the merge
 * rule live here, and so does the bridge that ships as `unframed-dials.js`: the engine
 * writes that file from `dialsBridgeSource()`, which embeds these very functions, so the
 * shipped copy and the tested definition are one.
 */

export type DialEntry =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "color"; readonly value: string }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "range"; readonly value: number; readonly min: number; readonly max: number; readonly step?: number }
  | { readonly kind: "select"; readonly value: string; readonly options: ReadonlyArray<string> }
  | { readonly kind: "folder"; readonly of: DialSchema };

export type DialSchema = { readonly [key: string]: DialEntry };

/** Parameter values: a plain nested object, folders as nested objects. */
export type DialValues = { [key: string]: unknown };

export type Normalised =
  | { readonly ok: true; readonly schema: DialSchema; readonly dialkit: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

export interface DialRules {
  /** Reads each value of `config` by its shape. The first malformed value stops it, named by its path from `dials`. */
  readonly normalise: (config: unknown) => Normalised;
  readonly defaults: (schema: DialSchema) => DialValues;
  /**
   * For each key the schema names: the saved value when present and of the same JS type as
   * the default, else the default. Folders recurse; keys the schema does not name are dropped.
   */
  readonly merge: (schema: DialSchema, saved: unknown) => DialValues;
  /** `next` over `current`, one level deep per folder, so a partial set keeps what it does not name. */
  readonly assign: (current: DialValues, next: unknown) => DialValues;
}

/**
 * The dial rules. Self-contained on purpose: the bridge embeds this function's source text,
 * so nothing inside it may refer to anything outside it.
 */
export function dialRules(): DialRules {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const COLOUR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
  const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

  type Built = { schema: Record<string, DialEntry>; dialkit: Record<string, unknown> } | { error: string };

  const build = (config: Record<string, unknown>, path: string): Built => {
    const schema: Record<string, DialEntry> = {};
    const dialkit: Record<string, unknown> = {};
    for (const key of Object.keys(config)) {
      const value = config[key];
      const at = `${path}.${key}`;
      if (isNumber(value)) {
        schema[key] = { kind: "number", value };
        dialkit[key] = value;
      } else if (typeof value === "boolean") {
        schema[key] = { kind: "boolean", value };
        dialkit[key] = value;
      } else if (typeof value === "string") {
        if (COLOUR.test(value)) {
          schema[key] = { kind: "color", value };
          dialkit[key] = { type: "color", default: value };
        } else {
          schema[key] = { kind: "text", value };
          dialkit[key] = { type: "text", default: value };
        }
      } else if (Array.isArray(value)) {
        if ((value.length === 3 || value.length === 4) && value.every(isNumber)) {
          const [current, min, max, step] = value as number[];
          schema[key] = { kind: "range", value: current!, min: min!, max: max!, ...(step === undefined ? {} : { step }) };
          dialkit[key] = value;
        } else if (value.length > 0 && value.every((item) => typeof item === "string")) {
          const options = value as string[];
          schema[key] = { kind: "select", value: options[0]!, options };
          dialkit[key] = { type: "select", options, default: options[0] };
        } else {
          return { error: `${at}: an array must be [value, min, max] numbers or a list of strings` };
        }
      } else if (isObject(value)) {
        const nested = build(value, at);
        if ("error" in nested) return nested;
        schema[key] = { kind: "folder", of: nested.schema };
        dialkit[key] = nested.dialkit;
      } else {
        return { error: `${at}: a parameter must be a number, a switch, text, a colour, a range or a list` };
      }
    }
    return { schema, dialkit };
  };

  const normalise = (config: unknown): Normalised => {
    if (!isObject(config)) return { ok: false, error: "dials: the parameters must be an object" };
    const built = build(config, "dials");
    return "error" in built ? { ok: false, error: built.error } : { ok: true, schema: built.schema, dialkit: built.dialkit };
  };

  const defaults = (schema: DialSchema): DialValues => {
    const values: DialValues = {};
    for (const key of Object.keys(schema)) {
      const entry = schema[key]!;
      values[key] = entry.kind === "folder" ? defaults(entry.of) : entry.value;
    }
    return values;
  };

  const merge = (schema: DialSchema, saved: unknown): DialValues => {
    const from = isObject(saved) ? saved : {};
    const values: DialValues = {};
    for (const key of Object.keys(schema)) {
      const entry = schema[key]!;
      if (entry.kind === "folder") {
        values[key] = merge(entry.of, from[key]);
        continue;
      }
      const value = from[key];
      values[key] = value !== undefined && typeof value === typeof entry.value ? value : entry.value;
    }
    return values;
  };

  const assign = (current: DialValues, next: unknown): DialValues => {
    const values: DialValues = { ...current };
    if (!isObject(next)) return values;
    for (const key of Object.keys(next)) {
      const before = values[key];
      const after = next[key];
      values[key] = isObject(before) && isObject(after) ? assign(before, after) : after;
    }
    return values;
  };

  return { normalise, defaults, merge, assign };
}

const rules = dialRules();
export const normaliseDials = rules.normalise;
export const defaultDialValues = rules.defaults;
export const mergeDialValues = rules.merge;
export const assignDialValues = rules.assign;

/** What a framed artifact announces to its framer. */
export interface DialsAnnouncement {
  readonly type: "unframed:dials";
  readonly name: string;
  readonly config: unknown;
  readonly schema: DialSchema;
  readonly values: DialValues;
}

/** The parts of a wheel event the bridge reads and forwards. */
export interface BridgeWheel {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly deltaMode: number;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

/** The parts of a right-click the bridge reads and forwards. */
export interface BridgeMenuEvent {
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

/** The window the bridge runs against: a browser's, or a test's stub. */
export interface BridgeWindow {
  /** The framer; the window itself when nothing frames it. */
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  location: { readonly origin: string };
  addEventListener(type: "message", listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
  addEventListener(type: "wheel", listener: (event: BridgeWheel) => void, options: { passive: boolean }): void;
  addEventListener(type: "contextmenu", listener: (event: BridgeMenuEvent) => void): void;
  __hfVariables?: { unframedDials?: unknown };
  unframed?: unknown;
  console: { error(...args: unknown[]): void };
}

/**
 * The bridge: defines `window.unframed.dials` and `window.unframed.defaultDials`. Self-
 * contained on purpose, like `dialRules`: the shipped file is this function's source text.
 */
export function installDialsBridge(win: BridgeWindow, dials: DialRules): void {
  const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const framed = (win.parent as unknown) !== win;
  type State = { name: string; config: unknown; schema: DialSchema; values: DialValues; apply: (values: DialValues) => void };
  let state: State | undefined;
  // The canvas that said hello: later declarations are announced to it too.
  let asker: string | undefined;
  // The canvas that asked for right-clicks, so a selected frame's shape menu still opens.
  let menuAsker: string | undefined;

  const run = (current: State) => {
    try {
      current.apply(current.values);
    } catch (error) {
      win.console.error("[unframed] applying parameters failed", error);
    }
  };

  const announce = (to?: string) => {
    if (!framed || state === undefined) return;
    const message = { type: "unframed:dials", name: state.name, config: state.config, schema: state.schema, values: state.values };
    try {
      win.parent.postMessage(message, to ?? asker ?? win.location.origin);
    } catch (error) {
      win.console.error("[unframed] could not announce the parameters", error);
    }
  };

  const set = (next: unknown) => {
    if (state === undefined) return;
    state.values = dials.merge(state.schema, dials.assign(state.values, next));
    run(state);
  };

  const declare = (name: unknown, config: unknown, apply: unknown) => {
    const normalised = dials.normalise(config);
    if (!normalised.ok) {
      win.console.error("[unframed] " + normalised.error);
      return null;
    }
    const current: State = {
      name: name === null || name === undefined ? "Parameters" : String(name),
      config,
      schema: normalised.schema,
      values: dials.merge(normalised.schema, win.__hfVariables?.unframedDials ?? null),
      apply: typeof apply === "function" ? (apply as (values: DialValues) => void) : () => {},
    };
    state = current;
    run(current);
    announce();
    return {
      get values() {
        return current.values;
      },
      set,
    };
  };

  const defaultDials = (config: unknown) => {
    const normalised = dials.normalise(config);
    return normalised.ok ? dials.defaults(normalised.schema) : null;
  };

  win.addEventListener("message", (event) => {
    if (event.source !== win.parent) return;
    if (event.origin !== win.location.origin && !LOOPBACK.test(event.origin)) return;
    const data = event.data as { type?: unknown; values?: unknown } | null;
    if (typeof data !== "object" || data === null) return;
    if (data.type === "unframed:dials:hello") {
      if (event.origin !== win.location.origin) asker = event.origin;
      menuAsker = (data as { menus?: unknown }).menus === true ? event.origin : undefined;
      announce(event.origin);
    } else if (data.type === "unframed:dials:set") {
      set(data.values);
    }
  });

  // A pinch (Ctrl or Cmd with the wheel) over a framed artifact would zoom the whole app:
  // the frame keeps it and hands it to the canvas that said hello, which zooms instead.
  if (framed) {
    win.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        if (asker === undefined) return;
        const { ctrlKey, metaKey, shiftKey, altKey, deltaX, deltaY, deltaZ, deltaMode, clientX, clientY } = event;
        try {
          win.parent.postMessage({ type: "unframed:wheel", ctrlKey, metaKey, shiftKey, altKey, deltaX, deltaY, deltaZ, deltaMode, clientX, clientY }, asker);
        } catch (error) {
          win.console.error("[unframed] could not hand the zoom to the canvas", error);
        }
      },
      { passive: false },
    );
  }

  // A right-click in a selected frame on the canvas opens the shape's menu, not the page's.
  if (framed) {
    win.addEventListener("contextmenu", (event) => {
      if (menuAsker === undefined) return;
      event.preventDefault();
      try {
        win.parent.postMessage({ type: "unframed:contextmenu", clientX: event.clientX, clientY: event.clientY }, menuAsker);
      } catch (error) {
        win.console.error("[unframed] could not hand the right-click to the canvas", error);
      }
    });
  }

  const existing = typeof win.unframed === "object" && win.unframed !== null ? (win.unframed as Record<string, unknown>) : {};
  win.unframed = { ...existing, dials: declare, defaultDials };
}

/** `unframed-dials.js`, as the engine writes it beside every artifact that carries the bridge. */
export const dialsBridgeSource = (): string =>
  [
    "/* unframed-dials.js: generated by Unframed and rewritten on every write. Do not edit it here: changes are lost. */",
    `(${installDialsBridge.toString()})(window, (${dialRules.toString()})());`,
    "",
  ].join("\n");
