import type { DatabaseSync } from "node:sqlite";
import { classifyOrigin, shapeKind, type SkippedBy, type TurnFile } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { CanvasChange, ChangeLogRow } from "../canvas/rooms.ts";

export interface TurnChangeRow {
  readonly shapeId: string;
  readonly before: TLRecord | null;
  readonly after: TLRecord | null;
  readonly beforeFile: string | null;
  readonly afterFile: string | null;
  readonly firstClock: number;
  readonly lastClock: number;
}

const fileOf = (record: TLRecord | null | undefined): string | null => {
  if (!record || record.typeName !== "shape" || (record.type !== "page" && record.type !== "motion")) return null;
  const file = (record.props as { file?: unknown }).file;
  return typeof file === "string" && file !== "" ? file : null;
};

/** JSON with its object keys sorted, so a record read back from the room compares equal to the one stored. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );

export const sameRecord = (a: TLRecord | null | undefined, b: TLRecord | null | undefined): boolean => stable(a ?? null) === stable(b ?? null);

/**
 * Turn changes (spec 07): per turn, every shape its tool calls touched, with the record
 * before the turn first touched it and after it last did. Several writes in one turn to
 * one shape collapse into one row. Only the engine writes `turn_changes`.
 */
export class TurnChanges {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  record(chatId: string, turn: number, before: ReadonlyMap<string, TLRecord | undefined>, after: ReadonlyMap<string, TLRecord | undefined>, clock: number): void {
    const find = this.db.prepare("SELECT before_json, before_file, first_clock FROM turn_changes WHERE chat_id = ? AND turn = ? AND shape_id = ?");
    const write = this.db.prepare(
      `INSERT OR REPLACE INTO turn_changes (chat_id, turn, shape_id, before_json, after_json, before_file, after_file, first_clock, last_clock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [shapeId, previous] of before) {
      const known = find.get(chatId, turn, shapeId) as Record<string, unknown> | undefined;
      const next = after.get(shapeId) ?? null;
      write.run(
        chatId,
        turn,
        shapeId,
        known ? (known.before_json as string | null) : previous === undefined ? null : JSON.stringify(previous),
        next === null ? null : JSON.stringify(next),
        known ? (known.before_file as string | null) : fileOf(previous),
        fileOf(next),
        known ? Number(known.first_clock) : clock,
        clock,
      );
    }
  }

  /** Forgets the turns past `keep`, which Edit from here dropped: their numbers are used again. */
  dropAfter(chatId: string, keep: number): void {
    this.db.prepare("DELETE FROM turn_changes WHERE chat_id = ? AND turn > ?").run(chatId, keep);
  }

  rows(chatId: string, turn: number): TurnChangeRow[] {
    return this.db
      .prepare("SELECT * FROM turn_changes WHERE chat_id = ? AND turn = ? ORDER BY first_clock, shape_id")
      .all(chatId, turn)
      .map((row) => ({
        shapeId: String(row.shape_id),
        before: row.before_json === null ? null : (JSON.parse(String(row.before_json)) as TLRecord),
        after: row.after_json === null ? null : (JSON.parse(String(row.after_json)) as TLRecord),
        beforeFile: row.before_file === null ? null : String(row.before_file),
        afterFile: row.after_file === null ? null : String(row.after_file),
        firstClock: Number(row.first_clock),
        lastClock: Number(row.last_clock),
      }));
  }

  /** The recap's rows for a turn: each shape it touched, how, and a page or motion's files. */
  files(chatId: string, turn: number): TurnFile[] {
    return this.rows(chatId, turn).map((row) => {
      const record = row.after ?? row.before;
      const change = row.before === null ? "created" : row.after === null ? "deleted" : "updated";
      return {
        shapeId: row.shapeId,
        kind: shapeKind(record?.typeName === "shape" ? record.type : undefined),
        change,
        ...(row.afterFile === null ? {} : { file: row.afterFile }),
        ...(row.beforeFile !== null && row.beforeFile !== row.afterFile ? { previousFile: row.beforeFile } : {}),
      };
    });
  }
}

export interface RevertPlan {
  readonly change: CanvasChange;
  readonly restored: string[];
  readonly skipped: Array<{ id: string; by: SkippedBy }>;
}

/**
 * Revert's skip rule: a shape whose current record still equals what the turn left is put
 * back as it was before the turn (removed when the turn created it, recreated when it
 * deleted it); any other shape is skipped and named with who changed it since, read from
 * the change log.
 */
export const planRevert = (
  chatId: string,
  rows: ReadonlyArray<TurnChangeRow>,
  current: ReadonlyMap<string, TLRecord>,
  log: ReadonlyArray<ChangeLogRow>,
): RevertPlan => {
  const put: TLRecord[] = [];
  const remove: string[] = [];
  const restored: string[] = [];
  const skipped: Array<{ id: string; by: SkippedBy }> = [];
  for (const row of rows) {
    const now = current.get(row.shapeId) ?? null;
    if (sameRecord(now, row.after)) {
      if (row.before === null) {
        if (now !== null) remove.push(row.shapeId);
      } else {
        put.push(row.before);
      }
      restored.push(row.shapeId);
      continue;
    }
    skipped.push({ id: row.shapeId, by: changedBy(chatId, row, log) });
  }
  return { change: { put, remove }, restored, skipped };
};

const changedBy = (chatId: string, row: TurnChangeRow, log: ReadonlyArray<ChangeLogRow>): SkippedBy => {
  let by: SkippedBy = "person";
  for (const entry of log) {
    if (entry.clock <= row.lastClock) continue;
    if (!entry.put.includes(row.shapeId) && !entry.removed.includes(row.shapeId)) continue;
    const author = classifyOrigin(entry.origin);
    if (author.kind === "system") continue;
    by = author.kind === "chat" ? (author.chatId === chatId ? "a later turn" : "another chat") : "person";
  }
  return by;
};
