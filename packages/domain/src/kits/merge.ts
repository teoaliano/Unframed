/**
 * Kit merge (spec 19): "Update from kit" is a three-way merge of the project's kit, the library
 * kit as the project last took it (the base) and the library kit as it is now, per token path
 * and per mode value. `replaceKit` is the other path: applying a different library kit.
 */
import { type Kit, type Token, type TokenValue } from "./types.ts";

export interface KitSide {
  readonly modes: string[];
  readonly tokens: Token[];
  readonly guidance?: string | undefined;
}

export interface MergeCounts {
  readonly updated: number;
  readonly added: number;
  readonly kept: number;
  readonly removed: number;
}

/** A value both sides changed differently, for one mode. `here` is the project's text, `kit` the library's. */
export interface MergeConflict {
  readonly path: string;
  readonly mode: string;
  readonly here: string;
  readonly kit: string;
}

/**
 * The person's choice per conflict, keyed `path|mode`, and the guidance's under `GUIDANCE_CHOICE`,
 * which holds no `|` and so never meets a token's key. Keeping the project's value is the default.
 */
export type MergeChoices = Readonly<Record<string, "mine" | "kit">>;

export const GUIDANCE_CHOICE = "guidance";

/** What the merge did with the guidance: took the library's, kept the project's change, or found both changed. Absent when nothing changed. */
export type GuidanceMerge = "updated" | "kept" | "conflict";

export interface MergeResult {
  readonly kit: Kit;
  readonly counts: MergeCounts;
  readonly conflicts: MergeConflict[];
  readonly guidance?: GuidanceMerge;
  /** Both sides' guidance when both changed it differently; an empty text is no guidance. */
  readonly guidanceConflict?: { readonly here: string; readonly kit: string };
}

/** A stable text of a value, with object keys sorted, so two equal values compare equal. */
const canon = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "undefined";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + canon((value as Record<string, unknown>)[key])).join(",") + "}";
};

const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

const text = (value: unknown): string => (value === undefined ? "(deleted)" : typeof value === "object" ? canon(value) : String(value));

/** The value a token has in a mode: its one value, its value for the mode, or the side's default mode's. */
const valueAt = (side: KitSide, token: Token | undefined, mode: string): TokenValue | undefined => {
  if (token === undefined) return undefined;
  if (token.value !== undefined) return token.value;
  const values = token.values ?? {};
  if (Object.prototype.hasOwnProperty.call(values, mode)) return values[mode];
  return values[side.modes[0]!];
};

const findToken = (side: KitSide, path: string): Token | undefined => side.tokens.find((token) => token.path === path);

/** The token written from per-mode values: one value when every mode has the same one, else a value per mode. */
const tokenFrom = (base: Pick<Token, "path" | "type" | "description" | "formerNames">, modes: string[], valueOf: (mode: string) => TokenValue): Token => {
  const values = modes.map((mode) => valueOf(mode));
  const single = values.every((value) => same(value, values[0]));
  const token: Token = { path: base.path, type: base.type, ...(single ? { value: values[0]! } : { values: Object.fromEntries(modes.map((mode, i) => [mode, values[i]!])) }) };
  if (base.description !== undefined) token.description = base.description;
  if (base.formerNames !== undefined) token.formerNames = base.formerNames;
  return token;
};

/**
 * Merges the library kit into the project. A conflict keeps the project's value unless the
 * choices name the library's. Counts: `updated` took the library's, `added` came from the
 * library, `kept` the project changed and kept, `removed` the library deleted and the project
 * keeps. The name, the modes' order and the link (`from`) are the project's.
 */
export const mergeKit = (input: { project: Kit; base: KitSide; library: KitSide }, choices: MergeChoices = {}): MergeResult => {
  const { project, base, library } = input;
  const modes = [...project.modes, ...library.modes.filter((mode) => !project.modes.includes(mode) && !base.modes.includes(mode))];
  const paths = [...project.tokens.map((token) => token.path), ...library.tokens.map((token) => token.path).filter((path) => !project.tokens.some((token) => token.path === path))];
  const tokens: Token[] = [];
  const conflicts: MergeConflict[] = [];
  const counts = { updated: 0, added: 0, kept: 0, removed: 0 };

  for (const path of paths) {
    const p = findToken(project, path);
    const b = findToken(base, path);
    const l = findToken(library, path);

    if (p !== undefined && b === undefined && l === undefined) {
      counts.kept++;
      tokens.push(p);
      continue;
    }
    if (p === undefined && b === undefined && l !== undefined) {
      counts.added++;
      tokens.push(structuredClone(l));
      continue;
    }
    if (p === undefined && b !== undefined && l === undefined) continue;
    if (p !== undefined && b !== undefined && l === undefined) {
      counts.removed++;
      tokens.push(p);
      continue;
    }
    if (p === undefined && b !== undefined && l !== undefined) {
      // The project deleted it. Unchanged in the library: it stays deleted. Changed: a conflict.
      const changed = modes.some((mode) => !same(valueAt(base, b, mode), valueAt(library, l, mode)));
      if (!changed) continue;
      const mode = modes[0]!;
      conflicts.push({ path, mode, here: "(deleted)", kit: text(valueAt(library, l, mode)) });
      if (choices[`${path}|${mode}`] === "kit") {
        counts.updated++;
        tokens.push(structuredClone(l));
      }
      continue;
    }

    // Both sides have it (or both added it): merge each mode's value on its own.
    const pToken = p!;
    let tookLibrary = false;
    let keptProject = false;
    const valueOf = (mode: string): TokenValue => {
      const pv = valueAt(project, pToken, mode);
      const bv = valueAt(base, b, mode);
      const lv = valueAt(library, l, mode);
      const projectChanged = !same(pv, bv);
      const libraryChanged = !same(lv, bv);
      if (!projectChanged && !libraryChanged) return pv!;
      if (!projectChanged && libraryChanged) {
        tookLibrary = true;
        return lv!;
      }
      if (projectChanged && !libraryChanged) {
        keptProject = true;
        return pv!;
      }
      if (same(pv, lv)) return pv!;
      const choice = choices[`${path}|${mode}`];
      conflicts.push({ path, mode, here: text(pv), kit: text(lv) });
      if (choice === "kit") {
        tookLibrary = true;
        return lv!;
      }
      keptProject = true;
      return pv!;
    };
    const merged = tokenFrom(pToken, modes, valueOf);
    const fromLibrary = l !== undefined ? tokenFrom(l, modes, (mode) => valueAt(library, l, mode)!) : undefined;
    const takesLibraryFields = tookLibrary && !keptProject && fromLibrary !== undefined;
    const row: Token = takesLibraryFields
      ? { ...merged, type: fromLibrary.type, ...(fromLibrary.description !== undefined ? { description: fromLibrary.description } : {}) }
      : merged;
    if (tookLibrary) counts.updated++;
    else if (keptProject) counts.kept++;
    tokens.push(row);
  }

  const { guidance: _guidance, ...rest } = project;
  const merged = mergeGuidance(project.guidance, base.guidance, library.guidance, choices[GUIDANCE_CHOICE]);
  return {
    kit: { ...rest, modes, tokens, ...(merged.text === undefined ? {} : { guidance: merged.text }) },
    counts,
    conflicts,
    ...(merged.outcome === undefined ? {} : { guidance: merged.outcome }),
    ...(merged.conflict === undefined ? {} : { guidanceConflict: merged.conflict }),
  };
};

/** The guidance merges as one more value: the side that changed it wins, and both changing it differently is a conflict. */
const mergeGuidance = (project: string | undefined, base: string | undefined, library: string | undefined, choice: "mine" | "kit" | undefined) => {
  const p = project ?? "";
  const b = base ?? "";
  const l = library ?? "";
  const text = (value: string) => (value === "" ? undefined : value);
  if (p === l) return { text: text(p), outcome: undefined, conflict: undefined };
  if (l === b) return { text: text(p), outcome: "kept" as const, conflict: undefined };
  if (p === b) return { text: text(l), outcome: "updated" as const, conflict: undefined };
  return { text: text(choice === "kit" ? l : p), outcome: "conflict" as const, conflict: { here: p, kit: l } };
};

/** Applies a different library kit: the project's modes with the library's added, the library's name, its tokens set and the project's others kept, and its guidance when it has one. The caller links it to the preset. */
export const replaceKit = (project: Kit, library: Kit): Kit => {
  const { from: _link, guidance: _guidance, ...rest } = project;
  const guidance = library.guidance ?? project.guidance;
  const modes = [...project.modes, ...library.modes.filter((mode) => !project.modes.includes(mode))];
  const tokens = [...project.tokens];
  for (const incoming of library.tokens) {
    const at = tokens.findIndex((token) => token.path === incoming.path);
    if (at === -1) tokens.push(structuredClone(incoming));
    else tokens[at] = structuredClone(incoming);
  }
  return { ...rest, name: library.name, modes, tokens, ...(guidance === undefined ? {} : { guidance }) };
};
