import { projectSlug } from "./slug.ts";

export const slug = projectSlug;

export const REF_TOKEN = /@([\w-]+)/g;

export const refTokens = (text: string): string[] => [...text.matchAll(REF_TOKEN)].map((match) => match[1]!);

export interface CanvasRecordLike {
  readonly id?: string;
  readonly typeName?: string;
  readonly type?: string;
  readonly props?: unknown;
  readonly meta?: unknown;
}

export const META_REF_TYPES: ReadonlySet<string> = new Set(["text", "image", "video", "page", "motion", "component"]);

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const isShape = (record: CanvasRecordLike): boolean => record.typeName === undefined || record.typeName === "shape";

const INLINE_NODES = new Set(["text", "hardBreak", "mention"]);

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

export const promptText = (shape: CanvasRecordLike): string | undefined =>
  isShape(shape) && shape.type === "text" ? plainText(field(shape.props, "richText")) : undefined;

const NUMERIC = /^\d+$/;
const FLOOR = 99n;

export const isMintedRef = (ref: string): boolean => NUMERIC.test(ref);

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

export const rewriteTokensOnPaste = (texts: ReadonlyArray<string>, ids: IdMap): string[] =>
  texts.map((text) =>
    text.replace(REF_TOKEN, (token, id: string) => {
      const next = lookup(ids, id);
      return next === undefined ? token : `@${next}`;
    }),
  );

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
