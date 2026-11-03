import { type Kit, type Token, type TokenValue } from "./types.ts";

export interface KitSide {
  readonly modes: string[];
  readonly tokens: Token[];
}

export interface MergeCounts {
  readonly updated: number;
  readonly added: number;
  readonly kept: number;
  readonly removed: number;
}

export interface MergeConflict {
  readonly path: string;
  readonly mode: string;
  readonly here: string;
  readonly kit: string;
}

export type MergeChoices = Readonly<Record<string, "mine" | "kit">>;

export interface MergeResult {
  readonly kit: Kit;
  readonly counts: MergeCounts;
  readonly conflicts: MergeConflict[];
}

const canon = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "undefined";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + canon((value as Record<string, unknown>)[key])).join(",") + "}";
};

const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

const text = (value: unknown): string => (value === undefined ? "(deleted)" : typeof value === "object" ? canon(value) : String(value));

const valueAt = (side: KitSide, token: Token | undefined, mode: string): TokenValue | undefined => {
  if (token === undefined) return undefined;
  if (token.value !== undefined) return token.value;
  const values = token.values ?? {};
  if (Object.prototype.hasOwnProperty.call(values, mode)) return values[mode];
  return values[side.modes[0]!];
};

const findToken = (side: KitSide, path: string): Token | undefined => side.tokens.find((token) => token.path === path);

const tokenFrom = (base: Pick<Token, "path" | "type" | "description" | "formerNames">, modes: string[], valueOf: (mode: string) => TokenValue): Token => {
  const values = modes.map((mode) => valueOf(mode));
  const single = values.every((value) => same(value, values[0]));
  const token: Token = { path: base.path, type: base.type, ...(single ? { value: values[0]! } : { values: Object.fromEntries(modes.map((mode, i) => [mode, values[i]!])) }) };
  if (base.description !== undefined) token.description = base.description;
  if (base.formerNames !== undefined) token.formerNames = base.formerNames;
  return token;
};

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

  return { kit: { ...project, modes, tokens }, counts, conflicts };
};

export const replaceKit = (project: Kit, library: Kit): Kit => {
  const { from: _link, ...rest } = project;
  const modes = [...project.modes, ...library.modes.filter((mode) => !project.modes.includes(mode))];
  const tokens = [...project.tokens];
  for (const incoming of library.tokens) {
    const at = tokens.findIndex((token) => token.path === incoming.path);
    if (at === -1) tokens.push(structuredClone(incoming));
    else tokens[at] = structuredClone(incoming);
  }
  return { ...rest, name: library.name, modes, tokens };
};
