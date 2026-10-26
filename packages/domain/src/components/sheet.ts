/**
 * Component sheets (spec 20): reads one sheet's four marked parts and refuses a malformed one
 * with the sentence the agent and the person see, first failure first. The markers are exact
 * and the template is found by its own div nesting, so the scan is regex-based like spec 09's
 * tag rules. No HTML parser ships in the web bundle.
 */

export type ComponentPropType = "text" | "boolean" | "image";

export type ComponentDeclaration = {
  readonly tag: string;
  readonly variants: Readonly<Record<string, readonly string[]>>;
  readonly props: Readonly<Record<string, ComponentPropType>>;
  readonly slots: readonly string[];
};

export type ComponentSheet = {
  readonly declaration: ComponentDeclaration;
  readonly style: string;
  readonly template: string;
  readonly examples: string;
};

export type ComponentSheetRead = { readonly ok: true; readonly sheet: ComponentSheet } | { readonly ok: false; readonly refusal: string };

export const COMPONENT_TAG_MAX = 50;
export const COMPONENT_VARIANTS_MAX = 4;
export const COMPONENT_VARIANT_VALUES_MAX = 12;
export const COMPONENT_PROPS_MAX = 16;
export const COMPONENT_SLOTS_MAX = 8;

const TAG = /^uf-[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NAME = /^[a-z][a-z0-9-]{0,30}$/;
const VALUE = /^[A-Za-z0-9_-]{1,40}$/;
const RESERVED = new Set(["id", "class", "style", "slot", "part", "hidden", "is", "tabindex"]);
const PROP_TYPES: readonly string[] = ["text", "boolean", "image"];

const isReservedName = (name: string): boolean => RESERVED.has(name) || name.startsWith("data-") || name.startsWith("aria-");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const componentTagRefusal = (tag: string): string =>
  `the tag ${tag} is not a component tag; use uf- and lowercase words joined by hyphens, like uf-price-card`;

const nameRefusal = (name: string): string =>
  `${name}: a variant or property name is lowercase letters, digits and hyphens, and is not id, class, style, slot, part, hidden, is, tabindex, or a data- or aria- name`;

const MESSAGES = {
  declaration: 'a component sheet needs one <script type="application/json" data-uf-component> declaration',
  shape: "the component declaration needs a tag, and variants, props and slots as lists and objects",
  style: 'a component sheet needs one <style type="text/x-uf-component" data-uf-component-style>',
  template: "a component sheet needs one <div data-uf-template hidden> holding its markup",
  script: "a component's template cannot hold a script; put behaviour in the page that uses it",
  examples: "a component sheet holds at most one <div data-uf-example hidden>",
  tooMany: "a component has at most 4 variants, 16 properties and 8 slots",
  slotName: 'slots: a slot is "" for the default slot, or a name of lowercase letters, digits and hyphens',
} as const;

type StartTag = { readonly name: string; readonly attrs: Readonly<Record<string, string>>; readonly end: number };

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The text with every comment blanked to spaces, so offsets still match the original. */
const blankComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));

const attributesOf = (source: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) attrs[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return attrs;
};

const startTags = (text: string): StartTag[] =>
  [...text.matchAll(START_TAG)].map((match) => ({
    name: match[1]!.toLowerCase(),
    attrs: attributesOf(match[2] ?? ""),
    end: match.index + match[0].length,
  }));

/**
 * The inner markup of an element whose start tag ends at `tag.end`. A raw-text element
 * (script, style) ends at its first closing tag; any other element ends at its own matching
 * closing tag, counting nested elements of its name.
 */
const innerOf = (html: string, text: string, tag: StartTag, rawText: boolean): string => {
  if (rawText) {
    const close = new RegExp(`</${tag.name}\\s*>`, "i").exec(text.slice(tag.end));
    return html.slice(tag.end, close ? tag.end + close.index : html.length);
  }
  const scan = new RegExp(`<${tag.name}(?=[\\s/>])[^>]*>|</${tag.name}\\s*>`, "gi");
  scan.lastIndex = tag.end;
  let depth = 1;
  for (let match = scan.exec(text); match; match = scan.exec(text)) {
    if (match[0].startsWith("</")) depth -= 1;
    else if (!match[0].endsWith("/>")) depth += 1;
    if (depth === 0) return html.slice(tag.end, match.index);
  }
  return html.slice(tag.end);
};

const hasAttribute = (tag: StartTag, name: string): boolean => Object.hasOwn(tag.attrs, name);

const readDeclaration = (json: string): ComponentDeclaration | string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return `the component declaration is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!isRecord(parsed)) return MESSAGES.shape;
  const tag = parsed.tag;
  if (typeof tag !== "string" || !TAG.test(tag) || tag.length > COMPONENT_TAG_MAX) return componentTagRefusal(String(tag));

  const variants = parsed.variants ?? {};
  const props = parsed.props ?? {};
  const slots = parsed.slots ?? [];
  if (!isRecord(variants) || !isRecord(props) || !Array.isArray(slots)) return MESSAGES.shape;
  const variantNames = Object.keys(variants);
  const propNames = Object.keys(props);

  for (const name of [...variantNames, ...propNames]) if (!NAME.test(name) || isReservedName(name)) return nameRefusal(name);
  for (const name of propNames) if (Object.hasOwn(variants, name)) return `${name} is both a variant and a property`;

  const variantOut: Record<string, string[]> = {};
  for (const name of variantNames) {
    const values = variants[name];
    const valid =
      Array.isArray(values) &&
      values.length >= 1 &&
      values.length <= COMPONENT_VARIANT_VALUES_MAX &&
      new Set(values).size === values.length &&
      values.every((value) => typeof value === "string" && VALUE.test(value));
    if (!valid) return `variants.${name}: a variant is a list of 1 to 12 distinct values made of letters, digits, hyphens and underscores`;
    variantOut[name] = [...(values as string[])];
  }

  const propOut: Record<string, ComponentPropType> = {};
  for (const name of propNames) {
    const type = props[name];
    if (typeof type !== "string" || !PROP_TYPES.includes(type)) return `props.${name}: a property is "text", "boolean" or "image"`;
    propOut[name] = type as ComponentPropType;
  }

  if (variantNames.length > COMPONENT_VARIANTS_MAX || propNames.length > COMPONENT_PROPS_MAX || slots.length > COMPONENT_SLOTS_MAX) {
    return MESSAGES.tooMany;
  }
  for (const slot of slots) {
    if (typeof slot !== "string" || (slot !== "" && !NAME.test(slot))) return MESSAGES.slotName;
  }
  return { tag, variants: variantOut, props: propOut, slots: [...(slots as string[])] };
};

/**
 * Reads a component sheet. Returns its declaration, style, template and examples, or the
 * first refusal sentence (spec 20, the sheet's refusals in order). Canvas rules (a tag held
 * by another shape, a changed tag) are not checked here.
 */
export const readComponentSheet = (html: string): ComponentSheetRead => {
  const text = blankComments(html);
  const tags = startTags(text);
  const refuse = (refusal: string): ComponentSheetRead => ({ ok: false, refusal });

  const declarations = tags.filter(
    (tag) => tag.name === "script" && tag.attrs.type === "application/json" && hasAttribute(tag, "data-uf-component"),
  );
  if (declarations.length !== 1) return refuse(MESSAGES.declaration);
  const declared = readDeclaration(innerOf(html, text, declarations[0]!, true).trim());
  if (typeof declared === "string") return refuse(declared);

  const styles = tags.filter((tag) => tag.name === "style" && tag.attrs.type === "text/x-uf-component" && hasAttribute(tag, "data-uf-component-style"));
  if (styles.length !== 1) return refuse(MESSAGES.style);
  const style = innerOf(html, text, styles[0]!, true);

  const templates = tags.filter((tag) => tag.name === "div" && hasAttribute(tag, "data-uf-template"));
  if (templates.length !== 1) return refuse(MESSAGES.template);
  const templateText = innerOf(text, text, templates[0]!, false);
  const template = innerOf(html, text, templates[0]!, false);

  const examples = tags.filter((tag) => tag.name === "div" && hasAttribute(tag, "data-uf-example"));
  if (examples.length > 1) return refuse(MESSAGES.examples);
  const example = examples[0] ? innerOf(html, text, examples[0], false) : "";

  const inside = startTags(templateText);
  for (const [name, type] of Object.entries(declared.props)) {
    if (type === "boolean") continue;
    if (!inside.some((tag) => tag.attrs["data-uf-prop"] === name)) return refuse(`props.${name}: no element in the template has data-uf-prop="${name}"`);
  }
  for (const slot of declared.slots) {
    const found = inside.some((tag) => tag.name === "slot" && (slot === "" ? !(tag.attrs.name ?? "") : tag.attrs.name === slot));
    if (!found) return refuse(slot === "" ? "slots: the template has no <slot>" : `slots: the template has no <slot name="${slot}">`);
  }
  if (/<script\b/i.test(templateText)) return refuse(MESSAGES.script);
  const nested = inside.find((tag) => tag.name.startsWith("uf-"));
  if (nested) {
    return refuse(
      `a component cannot hold another component yet; give it a slot and put ${nested.name} in that slot in the page instead`,
    );
  }

  return { ok: true, sheet: { declaration: declared, style, template, examples: example } };
};
