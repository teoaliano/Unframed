import { kitRefusal, modeRefusal } from "./rules.ts";
import { cssName } from "./runtime.ts";
import type { Kit, Token, TokenType, TokenValue } from "./types.ts";

export type KitOp =
  | { op: "create"; name: string; modes?: string[] }
  | { op: "rename"; name: string }
  | { op: "remove" }
  | { op: "setToken"; path: string; type: TokenType; value?: TokenValue; values?: Record<string, TokenValue>; description?: string }
  | { op: "addToken"; path: string; type: TokenType; value: TokenValue }
  | { op: "renameToken"; path: string; to: string }
  | { op: "deleteToken"; path: string }
  | { op: "forgetFormerName"; path: string; cssName: string }
  | { op: "addMode"; name: string; copyFrom?: string }
  | { op: "renameMode"; name: string; to: string }
  | { op: "deleteMode"; name: string }
  | { op: "setDefaultMode"; name: string }
  | { op: "reorder"; paths: string[] };

export type KitOpsResult = { ok: true; kit: Kit | null } | { ok: false; op: number; refusal: string };

class Refusal extends Error {}
function refuse(sentence: string): never {
  throw new Refusal(sentence);
}

const withoutToken = (kit: Kit, path: string): Token[] => kit.tokens.filter((token) => token.path !== path);
const findToken = (kit: Kit, path: string): Token => {
  const token = kit.tokens.find((candidate) => candidate.path === path);
  return token ?? refuse(`There is no token ${path} in the kit.`);
};

const modeNamed = (kit: Kit, name: string): void => {
  if (!kit.modes.includes(name)) refuse(`There is no mode ${name} in the kit.`);
};

const applyOne = (current: Kit | null, op: KitOp): Kit | null => {
  if (op.op === "create") {
    if (current !== null) refuse("This project already has a kit.");
    return { format: 1, name: op.name.trim(), modes: op.modes ?? ["default"], tokens: [] };
  }
  if (op.op === "remove") return null;
  if (current === null) refuse("This project has no kit yet.");
  const kit: Kit = structuredClone(current);

  switch (op.op) {
    case "rename":
      return { ...kit, name: op.name.trim() };

    case "setToken": {
      const existing = kit.tokens.find((token) => token.path === op.path);
      const token: Token = {
        path: op.path,
        type: op.type,
        ...(op.value !== undefined ? { value: op.value } : {}),
        ...(op.values !== undefined ? { values: op.values } : {}),
        ...(op.description !== undefined ? { description: op.description } : {}),
        ...(existing?.formerNames !== undefined ? { formerNames: existing.formerNames } : {}),
      };
      if (existing === undefined) return { ...kit, tokens: [...kit.tokens, token] };
      return { ...kit, tokens: kit.tokens.map((candidate) => (candidate.path === op.path ? token : candidate)) };
    }

    case "addToken":
      if (kit.tokens.some((token) => token.path === op.path)) refuse(`There is already a token ${op.path}.`);
      return { ...kit, tokens: [...kit.tokens, { path: op.path, type: op.type, value: op.value }] };

    case "renameToken": {
      const token = findToken(kit, op.path);
      const oldName = cssName(op.path);
      const keepsName = cssName(op.to) === oldName;
      const formerNames = keepsName ? token.formerNames : [...(token.formerNames ?? []), oldName];
      const renamed: Token = { ...token, path: op.to, ...(formerNames !== undefined ? { formerNames } : {}) };
      return { ...kit, tokens: kit.tokens.map((candidate) => (candidate.path === op.path ? renamed : candidate)) };
    }

    case "deleteToken":
      findToken(kit, op.path);
      return { ...kit, tokens: withoutToken(kit, op.path) };

    case "forgetFormerName": {
      const token = findToken(kit, op.path);
      const formerNames = (token.formerNames ?? []).filter((name) => name !== op.cssName);
      if (formerNames.length === (token.formerNames ?? []).length) refuse(`There is no former name ${op.cssName} on ${op.path}.`);
      const { formerNames: _dropped, ...rest } = token;
      const next: Token = formerNames.length > 0 ? { ...rest, formerNames } : rest;
      return { ...kit, tokens: kit.tokens.map((candidate) => (candidate.path === op.path ? next : candidate)) };
    }

    case "addMode": {
      if (kit.modes.includes(op.name)) refuse(`There is already a mode ${op.name}.`);
      const refusal = modeRefusal(op.name);
      if (refusal) refuse(refusal);
      if (op.copyFrom !== undefined) modeNamed(kit, op.copyFrom);
      const tokens = kit.tokens.map((token) => {
        if (op.copyFrom === undefined || token.values === undefined || !(op.copyFrom in token.values)) return token;
        return { ...token, values: { ...token.values, [op.name]: token.values[op.copyFrom]! } };
      });
      return { ...kit, modes: [...kit.modes, op.name], tokens };
    }

    case "renameMode": {
      modeNamed(kit, op.name);
      if (kit.modes.includes(op.to)) refuse(`There is already a mode ${op.to}.`);
      const refusal = modeRefusal(op.to);
      if (refusal) refuse(refusal);
      const tokens = kit.tokens.map((token) => {
        if (token.values === undefined || !(op.name in token.values)) return token;
        const values: Record<string, TokenValue> = {};
        for (const [mode, value] of Object.entries(token.values)) values[mode === op.name ? op.to : mode] = value;
        return { ...token, values };
      });
      return { ...kit, modes: kit.modes.map((mode) => (mode === op.name ? op.to : mode)), tokens };
    }

    case "deleteMode": {
      modeNamed(kit, op.name);
      if (kit.modes.length === 1) refuse("A kit keeps at least one mode.");
      const tokens = kit.tokens.map((token) => {
        if (token.values === undefined || !(op.name in token.values)) return token;
        const values = { ...token.values };
        delete values[op.name];
        return { ...token, values };
      });
      return { ...kit, modes: kit.modes.filter((mode) => mode !== op.name), tokens };
    }

    case "setDefaultMode":
      modeNamed(kit, op.name);
      return { ...kit, modes: [op.name, ...kit.modes.filter((mode) => mode !== op.name)] };

    case "reorder": {
      const listed = new Set<string>();
      for (const path of op.paths) {
        findToken(kit, path);
        if (listed.has(path)) refuse(`${path} is listed twice.`);
        listed.add(path);
      }
      const first = op.paths.map((path) => findToken(kit, path));
      return { ...kit, tokens: [...first, ...kit.tokens.filter((token) => !listed.has(token.path))] };
    }
  }
};

export const applyKitOps = (kit: Kit | null, ops: ReadonlyArray<KitOp>): KitOpsResult => {
  let current = kit;
  for (let index = 0; index < ops.length; index++) {
    try {
      current = applyOne(current, ops[index]!);
      const refusal = current === null ? null : kitRefusal(current);
      if (refusal) return { ok: false, op: index + 1, refusal };
    } catch (error) {
      if (error instanceof Refusal) return { ok: false, op: index + 1, refusal: error.message };
      throw error;
    }
  }
  return { ok: true, kit: current };
};

