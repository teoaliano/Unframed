/**
 * The kit's rows in a turn's changes (spec 19, Turn changes). A kit is recorded per part: one
 * row per token path (`kit:<path>`), `kit:modes` for the modes and default, and `kit:name`.
 * Each row holds the part as a small record, so the turn changes table keeps one shape for
 * shapes and kit parts alike. Revert restores a part only when it still holds what the turn
 * left, the same rule shapes follow, and names the part it skipped.
 */
import type { SkippedBy } from "@unframed/domain";
import { type Kit, type Token } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { ChangeLogRow } from "../canvas/rooms.ts";
import { changedBy, type TurnChangeRow } from "../agent/turnChanges.ts";

export const KIT_KEY_PREFIX = "kit:";

/** A kit part as the turn changes table holds it: a record-shaped value that is not a shape. */
interface KitPart {
  readonly typeName: "kit";
  readonly id: string;
  readonly value: unknown;
}

/** Every part of a kit, by its row key. An absent kit has no parts. */
export const kitEntries = (kit: Kit | null): Map<string, TLRecord | undefined> => {
  const parts = new Map<string, TLRecord | undefined>();
  if (kit === null) return parts;
  const part = (key: string, value: unknown) => parts.set(key, { typeName: "kit", id: key, value } as unknown as TLRecord);
  part(`${KIT_KEY_PREFIX}name`, kit.name);
  part(`${KIT_KEY_PREFIX}modes`, { modes: kit.modes, defaultMode: kit.modes[0] });
  for (const token of kit.tokens) part(`${KIT_KEY_PREFIX}${token.path}`, token);
  return parts;
};

/** The parts whose value changed, each as its before and after. */
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

/**
 * The kit after the revert's restores: each part whose current value equals what the turn
 * left goes back to its prior value, and every other part is skipped and named.
 */
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
  // The name first, so a kit the turn created goes whole before its tokens are looked at.
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
