import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  RoomSnapshot,
  SQLiteSyncStorage,
  TLSyncStorage,
  TLSyncStorageOnChangeCallbackProps,
  TLSyncStorageTransaction,
  TLSyncStorageTransactionCallback,
  TLSyncStorageTransactionOptions,
  TLSyncStorageTransactionResult,
} from "@tldraw/sync-core";
import type { TLRecord } from "@tldraw/tlschema";
import { readRef } from "@unframed/domain";

/** Who asked for a change: a tab's sessionId, an engine-side `apply` caller, or the engine itself. */
export interface ChangeOrigin {
  readonly kind: "session" | "server" | "system";
  readonly id: string;
}

/** One committed change, as the change log records it. */
export interface CommittedChange {
  readonly clock: number;
  readonly origin: ChangeOrigin;
  readonly at: string;
  readonly put: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  /** The put ids that did not exist before this change. */
  readonly created: ReadonlyArray<string>;
  /** The put ids whose ref this change set or changed. */
  readonly refChanged: ReadonlyArray<string>;
  /** The records as this change left them, by id. */
  readonly records: ReadonlyMap<string, TLRecord>;
}

type Txn = TLSyncStorageTransaction<TLRecord>;

/**
 * tldraw's SQLite sync storage, with every committed change also appended to
 * `canvas_changes` in the same SQLite transaction. The origin of a transaction is read
 * from `origin()` when it starts; the room sets it around each socket message and each
 * engine-side write.
 */
export class LoggedStorage implements TLSyncStorage<TLRecord> {
  private readonly insert: StatementSync;
  private readonly inner: SQLiteSyncStorage<TLRecord>;
  private readonly origin: () => ChangeOrigin;
  private readonly onCommit: (change: CommittedChange) => void;

  constructor(
    inner: SQLiteSyncStorage<TLRecord>,
    db: DatabaseSync,
    origin: () => ChangeOrigin,
    onCommit: (change: CommittedChange) => void,
  ) {
    this.inner = inner;
    this.origin = origin;
    this.onCommit = onCommit;
    this.insert = db.prepare(
      "INSERT INTO canvas_changes (clock, origin_kind, origin_id, at, put, removed) VALUES (?, ?, ?, ?, ?, ?)",
    );
  }

  transaction<T>(
    callback: TLSyncStorageTransactionCallback<TLRecord, T>,
    opts?: TLSyncStorageTransactionOptions,
  ): TLSyncStorageTransactionResult<T, TLRecord> {
    const origin = this.origin();
    let committed: CommittedChange | undefined;
    const run = (txn: Txn): T => {
      const put = new Set<string>();
      const removed = new Set<string>();
      const created = new Set<string>();
      const refChanged = new Set<string>();
      const records = new Map<string, TLRecord>();
      const tracked: Txn = {
        get: (id) => txn.get(id),
        set: (id, record) => {
          const before = txn.get(id);
          if (!put.has(id) && before === undefined) created.add(id);
          const ref = readRef(record);
          if (ref !== undefined && (before === undefined || readRef(before) !== ref)) refChanged.add(id);
          records.set(id, record);
          put.add(id);
          removed.delete(id);
          txn.set(id, record);
        },
        delete: (id) => {
          if (txn.get(id) !== undefined) {
            removed.add(id);
            put.delete(id);
            records.delete(id);
          }
          txn.delete(id);
        },
        keys: () => txn.keys(),
        values: () => txn.values(),
        entries: () => txn.entries(),
        getSchema: () => txn.getSchema(),
        setSchema: (schema) => txn.setSchema(schema),
        getClock: () => txn.getClock(),
        getChangesSince: (clock) => txn.getChangesSince(clock),
      };
      const value = (callback as (txn: Txn) => T)(tracked);
      if (put.size > 0 || removed.size > 0) {
        committed = { clock: txn.getClock(), origin, at: new Date().toISOString(), put: [...put], removed: [...removed], created: [...created].filter((id) => put.has(id)),
          refChanged: [...refChanged].filter((id) => put.has(id)),
          records,
        };
        this.insert.run(
          committed.clock,
          origin.kind,
          origin.id,
          committed.at,
          JSON.stringify(committed.put),
          JSON.stringify(committed.removed),
        );
      }
      return value;
    };
    const result = this.inner.transaction(run as never, opts) as TLSyncStorageTransactionResult<T, TLRecord>;
    if (committed) this.onCommit(committed);
    return result;
  }

  getClock(): number {
    return this.inner.getClock();
  }

  onChange(callback: (arg: TLSyncStorageOnChangeCallbackProps) => unknown): () => void {
    return this.inner.onChange(callback);
  }

  getSnapshot(): RoomSnapshot {
    return this.inner.getSnapshot();
  }
}
