
export type OwnerField = { readonly kind: "style"; readonly property: string } | { readonly kind: "text" } | { readonly kind: "src" };

export interface OwnerSource {
  readonly inline: Readonly<Record<string, string>>;
  readonly text: string | null;
  readonly src: string | null;
}

export interface OwnerLive {
  readonly inline: Readonly<Record<string, string | null>>;
  readonly text: string | null;
  readonly src: string | null;
  readonly animated: readonly string[];
}

export type FieldOwner =
  | { readonly owner: "source" }
  | { readonly owner: "dial"; readonly path: string }
  | { readonly owner: "token"; readonly name: string }
  | { readonly owner: "script" | "animated" | "locked" };

export interface FieldOwnerInput {
  readonly field: OwnerField;
  readonly source: OwnerSource | null;
  readonly live: OwnerLive;
  readonly dials: Readonly<Record<string, unknown>>;
  readonly kitNames?: readonly string[];
  readonly locked: boolean;
  readonly normalise: (value: string) => string;
  readonly expand: (shorthand: string, value: string, longhand: string) => string;
}

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

const kitVarName = (value: string | null, kitNames: readonly string[]): string | null => {
  if (value === null) return null;
  const match = /^var\((--[A-Za-z0-9_-]+)(?:\s*,[\s\S]*)?\)$/.exec(value.trim());
  return match !== null && kitNames.includes(match[1]!) ? match[1]! : null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

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

export function fieldOwner(input: FieldOwnerInput): FieldOwner {
  if (input.locked) return { owner: "locked" };
  const { source, live, dials, normalise } = input;
  if (source === null) return { owner: "script" };
  const { field } = input;

  if (field.kind === "style") {
    if (live.animated.includes(field.property)) return { owner: "animated" };
    const tokenName = kitVarName(source.inline[field.property] ?? null, input.kitNames ?? []);
    if (tokenName !== null && live.inline[field.property] === source.inline[field.property]) return { owner: "token", name: tokenName };
    const liveValue = live.inline[field.property] ?? null;
    const sourceValue = sourceValueOf(source.inline, field.property, input.expand);
    if (liveValue === sourceValue || (liveValue !== null && sourceValue !== null && normalise(liveValue) === normalise(sourceValue))) {
      return { owner: "source" };
    }
    if (liveValue === null) return { owner: "script" };
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
