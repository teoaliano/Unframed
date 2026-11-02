import type { Kit, Token, TokenValue } from "./types.ts";

/**
 * The kit's runtime rules: CSS names, alias resolution, the CSS the tokens script writes and
 * the values `unframed.token()` returns. One function, so the browser's copy in the tokens
 * script and the engine's copy (for the CSS export and the stamp) cannot drift.
 *
 * Self-contained on purpose, like `dialRules`: the tokens script embeds this function's
 * source text, so nothing inside it may refer to anything outside it. Types are erased.
 */
export function kitCore(easeCss: Readonly<Record<string, string>>) {
  const SUFFIX = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing"];
  const FIELDS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"];
  const ALIAS = /^\{(.+)\}$/;
  const BEZIER = /^cubic-bezier\(\s*([^,)]+),\s*([^,)]+),\s*([^,)]+),\s*([^,)]+)\)$/i;
  const MAX_DEPTH = 32;

  const cssName = (path: string): string => "--" + path.split("/").join("-");

  const find = (kit: Kit, path: string): Token | undefined => {
    for (const token of kit.tokens) if (token.path === path) return token;
    return undefined;
  };

  const modeOf = (kit: Kit, mode: string | undefined): string => (mode !== undefined && kit.modes.includes(mode) ? mode : kit.modes[0]!);

  /** The stored value for a mode, falling back to the default mode's. */
  const rawValue = (kit: Kit, token: Token, mode: string): TokenValue | undefined => {
    if (token.value !== undefined) return token.value;
    const values = token.values ?? {};
    if (Object.prototype.hasOwnProperty.call(values, mode)) return values[mode];
    return values[kit.modes[0]!];
  };

  const resolveScalar = (kit: Kit, raw: unknown, mode: string, depth: number): unknown => {
    if (typeof raw === "string") {
      const match = ALIAS.exec(raw);
      if (match) {
        const target = find(kit, match[1]!);
        return target === undefined ? undefined : resolveToken(kit, target, mode, depth + 1);
      }
    }
    return raw;
  };

  const resolveToken = (kit: Kit, token: Token, mode: string, depth: number): unknown => {
    if (depth > MAX_DEPTH) return undefined;
    const raw = rawValue(kit, token, mode);
    if (raw === undefined) return undefined;
    if (token.type === "textStyle" && typeof raw === "object" && raw !== null) {
      const out: Record<string, unknown> = {};
      for (const field of FIELDS) {
        const value = resolveScalar(kit, (raw as unknown as Record<string, unknown>)[field], mode, depth);
        if (value === undefined) return undefined;
        out[field] = value;
      }
      return out;
    }
    return resolveScalar(kit, raw, mode, depth);
  };

  /** The value at a path with aliases followed, in the mode asked for (the default mode when it is not one of the kit's). */
  const resolve = (kit: Kit, path: string, mode?: string): TokenValue | undefined => {
    const token = find(kit, path);
    if (token === undefined) return undefined;
    return resolveToken(kit, token, modeOf(kit, mode), 0) as TokenValue | undefined;
  };

  const cssText = (kit: Kit, raw: unknown, type?: string): string => {
    if (typeof raw === "string") {
      const match = ALIAS.exec(raw);
      if (match) {
        const target = find(kit, match[1]!);
        return target === undefined ? "initial" : "var(" + cssName(target.path) + ")";
      }
      if (type === "easing" && easeCss[raw] !== undefined) return easeCss[raw]!;
    }
    return String(raw);
  };

  /** The custom properties one token writes in one mode, as [name, value] pairs. */
  const declarations = (kit: Kit, token: Token, mode: string): Array<[string, string]> => {
    const base = cssName(token.path);
    const raw = rawValue(kit, token, mode);
    if (token.type === "textStyle") {
      if (typeof raw === "string") {
        const match = ALIAS.exec(raw);
        const target = match ? find(kit, match[1]!) : undefined;
        return SUFFIX.map((sub) => [base + "-" + sub, target === undefined ? "initial" : "var(" + cssName(target.path) + "-" + sub + ")"]);
      }
      const fields = (raw ?? {}) as unknown as Record<string, unknown>;
      return FIELDS.map((field, i) => [base + "-" + SUFFIX[i], cssText(kit, fields[field])]);
    }
    return [[base, cssText(kit, raw, token.type)]];
  };

  /** A former name: the custom property a renamed token used to have, written as var() of its new one. */
  const formerDeclarations = (token: Token): Array<[string, string]> => {
    const base = cssName(token.path);
    return (token.formerNames ?? []).flatMap((former) =>
      token.type === "textStyle"
        ? SUFFIX.map((sub): [string, string] => [former + "-" + sub, "var(" + base + "-" + sub + ")"])
        : [[former, "var(" + base + ")"]],
    );
  };

  const block = (selector: string, pairs: Array<[string, string]>): string =>
    selector + " {\n" + pairs.map(([name, value]) => "  " + name + ": " + value + ";\n").join("") + "}\n";

  /** The stylesheet text: the default mode on :root, the rest as [data-theme] blocks holding only what differs. */
  const kitCss = (kit: Kit): string => {
    const defaultMode = kit.modes[0]!;
    const rootPairs: Array<[string, string]> = [];
    const defaults = new Map<string, string>();
    for (const token of kit.tokens) {
      for (const pair of declarations(kit, token, defaultMode)) {
        rootPairs.push(pair);
        defaults.set(pair[0], pair[1]);
      }
    }
    for (const token of kit.tokens) rootPairs.push(...formerDeclarations(token));
    let css = block(":root", rootPairs);
    for (const mode of kit.modes.slice(1)) {
      const pairs: Array<[string, string]> = [];
      for (const token of kit.tokens) {
        for (const pair of declarations(kit, token, mode)) if (defaults.get(pair[0]) !== pair[1]) pairs.push(pair);
      }
      css += block('[data-theme="' + mode + '"]', pairs);
    }
    return css;
  };

  const weight = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const text = value.trim();
    return text !== "" && Number.isFinite(Number(text)) ? Number(text) : value;
  };

  const bezier = (x1: number, y1: number, x2: number, y2: number): ((progress: number) => number) => {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
    const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
    return (progress: number) => {
      if (progress <= 0) return 0;
      if (progress >= 1) return 1;
      let low = 0;
      let high = 1;
      let t = progress;
      for (let i = 0; i < 60; i++) {
        t = (low + high) / 2;
        if (sampleX(t) < progress) low = t;
        else high = t;
      }
      return sampleY(t);
    };
  };

  /** The value `unframed.token(path)` returns: CSS text, a number for a duration in seconds, an object for a text style, a GSAP name or a function for an easing. Undefined for no such token. */
  const scriptValue = (kit: Kit, pathOrName: string, mode?: string): unknown => {
    const token = find(kit, pathOrName) ?? kit.tokens.find((candidate) => cssName(candidate.path) === pathOrName);
    if (token === undefined) return undefined;
    const current = modeOf(kit, mode);
    const resolved = resolveToken(kit, token, current, 0);
    if (resolved === undefined) return undefined;
    switch (token.type) {
      case "duration": {
        const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(String(resolved).trim());
        if (!match) return undefined;
        return match[2] === "ms" ? Number(match[1]) / 1000 : Number(match[1]);
      }
      case "fontWeight":
        return weight(resolved);
      case "textStyle": {
        const fields = resolved as unknown as Record<string, unknown>;
        return { ...fields, fontWeight: weight(fields["fontWeight"]) };
      }
      case "easing": {
        const text = String(resolved).trim();
        const match = BEZIER.exec(text);
        if (match) return bezier(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]));
        return text;
      }
      default:
        return String(resolved);
    }
  };

  return { cssName, resolve, kitCss, scriptValue, declarations, formerDeclarations };
}

export type KitCore = ReturnType<typeof kitCore>;
