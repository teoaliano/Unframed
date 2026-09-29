/**
 * Old graph files written by hand for the reader's tests: a snapshot at a version and a
 * journal of entries after it, in the old app's formats.
 */
export type Json = Record<string, unknown>;

export const prompt = (id: string, text = "", extra: Json = {}): Json => ({ id, type: "prompt", position: { x: 0, y: 0 }, data: { text }, ...extra });
export const image = (id: string, extra: Json = {}): Json => ({ id, type: "image", position: { x: 0, y: 0 }, width: 240, data: { fileName: "" }, ...extra });
export const group = (id: string, extra: Json = {}): Json => ({ id, type: "group", position: { x: 0, y: 0 }, width: 420, height: 280, data: {}, ...extra });
export const imageOutput = (id: string, extra: Json = {}): Json => ({ id, type: "imageOutput", position: { x: 400, y: 0 }, data: { model: "openai/gpt-image-2" }, ...extra });
export const edge = (source: string, target: string, extra: Json = {}): Json => ({ id: `e-${source}-${target}`, source, target, ...extra });

/** A snapshot at `version`; `null` writes none, as graphs from before the journal did. */
export const snapshot = (nodes: Json[], edges: Json[] = [], version: number | null = 1): string =>
  JSON.stringify({ ...(version === null ? {} : { version }), nodes, edges }, null, 2);

/** One journal line: `op` applied at `version`. */
export const entry = (version: number, op: Json, extra: Json = {}): string =>
  JSON.stringify({ version, op, inverse: null, origin: { kind: "session", id: "s-1" }, at: 1_789_000_000_000 + version, ...extra });

/** A journal whose entries follow a version-1 snapshot, one per op. */
export const journal = (ops: Json[], from = 2): string => ops.map((op, index) => entry(from + index, op)).join("\n") + "\n";
