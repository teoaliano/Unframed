/**
 * Field owner (spec 18): what holds a value on screen, which decides what an edit to it changes.
 * The owner rule is decided at run time by comparing the live element with its source, so no
 * script is read. Spec 19 adds `token` before the style comparison.
 *
 * A longhand the source sets only through a shorthand (`background: #fff` sets background-color)
 * counts as the source's own value: the browser expands the shorthand, through `expand`.
 */

/** The field an owner question is about: a style property, the text, or an image's `src`. */
export type OwnerField = { readonly kind: "style"; readonly property: string } | { readonly kind: "text" } | { readonly kind: "src" };

/** What the source says about the element. `null` in `fieldOwner` means no id in the source (a runtime element). */
export interface OwnerSource {
  /** The element's inline declarations, property names lowercased, values as written. */
  readonly inline: Readonly<Record<string, string>>;
  /** The text when the element is text-only, else null. */
  readonly text: string | null;
  readonly src: string | null;
}

/** What the live element shows. `null` in `inline` means no inline value. */
export interface OwnerLive {
  readonly inline: Readonly<Record<string, string | null>>;
  readonly text: string | null;
  readonly src: string | null;
  /** The CSS properties a motion animates on the element. */
  readonly animated: readonly string[];
}

export type FieldOwner =
  | { readonly owner: "source" }
  | { readonly owner: "dial"; readonly path: string }
  | { readonly owner: "script" | "animated" | "locked" };

export interface FieldOwnerInput {
  readonly field: OwnerField;
  readonly source: OwnerSource | null;
  readonly live: OwnerLive;
  /** The saved dial values, nested by folder. */
  readonly dials: Readonly<Record<string, unknown>>;
  /** The element or one of its ancestors is locked. */
  readonly locked: boolean;
  /** Reads a value into the form the browser compares by, for example colours to `rgb()`. */
  readonly normalise: (value: string) => string;
  /** The value the browser gives `longhand` when `shorthand: value` is the only declaration (spec 18). */
  readonly expand: (shorthand: string, value: string, longhand: string) => string;
}

/** The shorthands in the Design fields that set a longhand, so a literal shorthand in the source sets the longhand too. */
const SHORTHANDS: Readonly<Record<string, readonly string[]>> = {
  "background-color": ["background"],
  "border-width": ["border"],
  "border-style": ["border"],
  "border-color": ["border"],
  "padding-top": ["padding"],
  "padding-right": ["padding"],
  "padding-bottom": ["padding"],
  "padding-left": ["padding"],
  "margin-top": ["margin"],
  "margin-right": ["margin"],
  "margin-bottom": ["margin"],
  "margin-left": ["margin"],
  "font-family": ["font"],
  "font-size": ["font"],
  "font-weight": ["font"],
  "line-height": ["font"],
  "flex-direction": ["flex-flow"],
  "flex-wrap": ["flex-flow"],
};

/**
 * The value the source gives a property: its own declaration, else the value a shorthand in the
 * source gives it. A longhand declared after its shorthand is the longhand's own (the cascade).
 */
const sourceValueOf = (inline: Readonly<Record<string, string>>, property: string, expand: FieldOwnerInput["expand"]): string | null => {
  const declared = inline[property] ?? null;
  if (declared !== null) return declared;
  for (const shorthand of SHORTHANDS[property] ?? []) {
    const value = inline[shorthand] ?? null;
    if (value !== null) return expand(shorthand, value, property);
  }
  return null;
};

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every dial leaf whose value the predicate accepts, by its dotted path, in declaration order. */
const dialPaths = (dials: Readonly<Record<string, unknown>>, accepts: (value: unknown) => boolean, prefix = ""): string[] => {
  const found: string[] = [];
  for (const key of Object.keys(dials)) {
    const value = dials[key];
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isPlainObject(value)) found.push(...dialPaths(value, accepts, path));
    else if (accepts(value)) found.push(path);
  }
  return found;
};

/** The owner of a field. Checked in order: locked, script (a runtime element), animated, then the value's own comparison. */
export function fieldOwner(input: FieldOwnerInput): FieldOwner {
  if (input.locked) return { owner: "locked" };
  const { source, live, dials, normalise } = input;
  if (source === null) return { owner: "script" };
  const { field } = input;

  if (field.kind === "style") {
    if (live.animated.includes(field.property)) return { owner: "animated" };
    const liveValue = live.inline[field.property] ?? null;
    const sourceValue = sourceValueOf(source.inline, field.property, input.expand);
    if (liveValue === sourceValue || (liveValue !== null && sourceValue !== null && normalise(liveValue) === normalise(sourceValue))) {
      return { owner: "source" };
    }
    if (liveValue === null) return { owner: "script" };
    // A dial that set the value: its number with or without a CSS unit, or its colour after normalising.
    const matches = (value: unknown): boolean => {
      const forms = typeof value === "number" ? [String(value), `${value}px`] : typeof value === "string" ? [value] : [];
      return forms.some((form) => form === liveValue || normalise(form) === normalise(liveValue));
    };
    const hits = dialPaths(dials, matches);
    return hits.length === 1 ? { owner: "dial", path: hits[0]! } : { owner: "script" };
  }

  const shown = field.kind === "text" ? live.text : live.src;
  const written = field.kind === "text" ? source.text : source.src;
  if (shown === null) return { owner: "script" };
  const same = field.kind === "text" ? (a: string, b: string) => collapse(a) === collapse(b) : (a: string, b: string) => a === b;
  if (written !== null && same(written, shown)) return { owner: "source" };
  const hits = dialPaths(dials, (value) => typeof value === "string" && same(value, shown));
  return hits.length === 1 ? { owner: "dial", path: hits[0]! } : { owner: "script" };
}
