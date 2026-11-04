import type { SkippedBy } from "@unframed/domain";
import { type Kit, type Token } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { ChangeLogRow } from "../canvas/rooms.ts";
import { changedBy, type TurnChangeRow } from "../agent/turnChanges.ts";

const KIT_KEY_PREFIX = "kit:";

export const KIT_GUIDANCE_KEY = `${KIT_KEY_PREFIX}:guidance`;

interface KitPart {
  readonly typeName: "kit";
  readonly id: string;
  readonly value: unknown;
}

const kitEntries = (kit: Kit | null): Map<string, TLRecord | undefined> => {
  const parts = new Map<string, TLRecord | undefined>();
  if (kit === null) return parts;
  const part = (key: string, value: unknown) => parts.set(key, { typeName: "kit", id: key, value } as unknown as TLRecord);
  part(`${KIT_KEY_PREFIX}name`, kit.name);
  part(`${KIT_KEY_PREFIX}modes`, { modes: kit.modes, defaultMode: kit.modes[0] });
  if (kit.guidance !== undefined) part(KIT_GUIDANCE_KEY, kit.guidance);
  for (const token of kit.tokens) part(`${KIT_KEY_PREFIX}${token.path}`, token);
  return parts;
};

export const changedKitParts = (before: Kit | null, after: Kit | null) => {
  const old = kitEntries(before);
  const next = kitEntries(after);
  const keys = new Set([...old.keys(), ...next.keys()]);
  const changed = { before: new Map<string, TLRecord | undefined>(), after: new Map<string, TLRecord | undefined>() };
  for (const key of keys) {
    const a = old.get(key);
    const b = next.get(key);
    if (JSON.stringify(valueOf(a) ?? null) === JSON.stringify(valueOf(b) ?? null)) continue;
    changed.before.set(key, a);
    changed.after.set(key, b);
  }
  return changed;
};

const valueOf = (record: TLRecord | null | undefined): unknown => (record === null || record === undefined ? undefined : (record as unknown as KitPart).value);

export const planKitRevert = (
  chatId: string,
  rows: ReadonlyArray<TurnChangeRow>,
  current: Kit | null,
  log: ReadonlyArray<ChangeLogRow>,
): { kit: Kit | null; changed: boolean; restored: string[]; skipped: Array<{ id: string; by: SkippedBy }> } => {
  const currentParts = kitEntries(current);
  let kit: Kit | null = current === null ? null : structuredClone(current);
  let changed = false;
  const restored: string[] = [];
  const skipped: Array<{ id: string; by: SkippedBy }> = [];
  const ordered = [...rows].sort((a, b) => (a.shapeId === `${KIT_KEY_PREFIX}name` ? -1 : b.shapeId === `${KIT_KEY_PREFIX}name` ? 1 : 0));
  for (const row of ordered) {
    const now = currentParts.get(row.shapeId);
    if (JSON.stringify(valueOf(now) ?? null) !== JSON.stringify(valueOf(row.after) ?? null)) {
      skipped.push({ id: row.shapeId, by: changedBy(chatId, row, log) });
      continue;
    }
    restored.push(row.shapeId);
    changed = true;
    const before = valueOf(row.before);
    if (row.shapeId === `${KIT_KEY_PREFIX}name`) {
      if (before === undefined) kit = null;
      else if (kit !== null) kit = { ...kit, name: String(before) };
      continue;
    }
    if (kit === null) continue;
    if (row.shapeId === `${KIT_KEY_PREFIX}modes`) {
      const modes = (before as { modes?: string[] } | undefined)?.modes;
      if (modes !== undefined) kit = { ...kit, modes };
      continue;
    }
    if (row.shapeId === KIT_GUIDANCE_KEY) {
      const { guidance: _guidance, ...rest } = kit;
      kit = typeof before === "string" ? { ...rest, guidance: before } : rest;
      continue;
    }
    const path = row.shapeId.slice(KIT_KEY_PREFIX.length);
    const others = kit.tokens.filter((token) => token.path !== path);
    if (before === undefined) {
      kit = { ...kit, tokens: others };
      continue;
    }
    const existing = kit.tokens.find((token) => token.path === path);
    const replacement = before as Token;
    kit = { ...kit, tokens: existing ? kit.tokens.map((token) => (token.path === path ? replacement : token)) : [...others, replacement] };
  }
  return { kit, changed, restored, skipped };
};
