import { projectSlug } from "./slug.ts";

/** Spec 01's slug rule, the one definition: project names, file names and group names. */
export const slug = projectSlug;

/** An `@id` reference: `@` followed by word characters and hyphens. */
export const REF_TOKEN = /@([\w-]+)/g;

/** The ids every `@` token in `text` names, in order. */
export const refTokens = (text: string): string[] => [...text.matchAll(REF_TOKEN)].map((match) => match[1]!);

/**
 * The narrow view of a canvas record these rules read. Records that are not shapes
 * (pages, assets, the document) may be passed and are ignored.
 */
export interface CanvasRecordLike {
  readonly id?: string;
  readonly typeName?: string;
  readonly type?: string;
  readonly props?: unknown;
  readonly meta?: unknown;
}

/** The shape kinds that carry their ref in `meta.ref`. A group's name is its ref. */
/** The shape kinds that carry a ref in `meta.ref`. A group's ref is its name. */
export const META_REF_TYPES: ReadonlySet<string> = new Set(["text", "image", "video", "page", "motion"]);

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const isShape = (record: CanvasRecordLike): boolean => record.typeName === undefined || record.typeName === "shape";

const INLINE_NODES = new Set(["text", "hardBreak", "mention"]);

/** The plain text of tldraw rich text: paragraphs joined by `\n`. This is the prompt's text for every other purpose. */
export const plainText = (richText: unknown): string => {
  const render = (node: unknown): string => {
    const type = field(node, "type");
    if (type === "text") {
      const text = field(node, "text");
      return typeof text === "string" ? text : "";
    }
    if (type === "hardBreak") return "\n";
    const content = field(node, "content");
    if (!Array.isArray(content)) return "";
    const inline = content.every((child) => INLINE_NODES.has(String(field(child, "type"))));
    return content.map(render).join(inline ? "" : "\n");
  };
  return render(richText);
};

/** A shape's ref: `meta.ref` for prompts, media, pages and motions, `props.name` for a group. */
export const readRef = (shape: CanvasRecordLike): string | undefined => {
  if (!isShape(shape)) return undefined;
  if (shape.type === "frame") {
    const name = field(shape.props, "name");
    return typeof name === "string" ? name : undefined;
  }
  if (shape.type !== undefined && META_REF_TYPES.has(shape.type)) {
    const ref = field(shape.meta, "ref");
    return typeof ref === "string" ? ref : undefined;
  }
  return undefined;
};

/** A prompt's plain text, or `undefined` for any other record. */
export const promptText = (shape: CanvasRecordLike): string | undefined =>
  isShape(shape) && shape.type === "text" ? plainText(field(shape.props, "richText")) : undefined;

const NUMERIC = /^\d+$/;
const FLOOR = 99n;

/**
 * The ref for a new shape: one more than the largest number among every numeric ref on
 * the canvas, every numeric `@` token in any prompt's text, and 99. Counting the tokens
 * is what stops a new shape from capturing a reference to a shape that was deleted.
 */
export const nextRef = (records: Iterable<CanvasRecordLike>): string => {
  let largest = FLOOR;
  const consider = (candidate: string) => {
    if (!NUMERIC.test(candidate)) return;
    const value = BigInt(candidate);
    if (value > largest) largest = value;
  };
  for (const record of records) {
    const ref = readRef(record);
    if (ref !== undefined) consider(ref);
    const text = promptText(record);
    if (text !== undefined) for (const token of refTokens(text)) consider(token);
  }
  return (largest + 1n).toString();
};

type IdMap = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

const lookup = (ids: IdMap, id: string): string | undefined =>
  ids instanceof Map ? ids.get(id) : Object.hasOwn(ids, id) ? (ids as Record<string, string>)[id] : undefined;

/**
 * Pasted prompts that reference each other keep referencing each other: every whole
 * token that names a pasted shape's old ref becomes its new ref. Unknown tokens stay as
 * typed, and a rewritten token is never rewritten again.
 */
export const rewriteTokensOnPaste = (texts: ReadonlyArray<string>, ids: IdMap): string[] =>
  texts.map((text) =>
    text.replace(REF_TOKEN, (token, id: string) => {
      const next = lookup(ids, id);
      return next === undefined ? token : `@${next}`;
    }),
  );

/** `rewriteTokensOnPaste` over every text node of tldraw rich text. Answers a new document. */
export const rewriteRichTextTokens = <T>(richText: T, ids: IdMap): T => {
  const visit = (node: unknown): unknown => {
    if (typeof node !== "object" || node === null) return node;
    const record = node as Record<string, unknown>;
    const next: Record<string, unknown> = { ...record };
    if (record.type === "text" && typeof record.text === "string") {
      next.text = rewriteTokensOnPaste([record.text], ids)[0];
    }
    if (Array.isArray(record.content)) next.content = record.content.map(visit);
    return next;
  };
  return visit(richText) as T;
};
