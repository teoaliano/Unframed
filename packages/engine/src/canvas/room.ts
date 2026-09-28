import type { DatabaseSync } from "node:sqlite";
import { canvasSchema } from "@unframed/contracts";
import { nextRef, readRef } from "@unframed/domain";
import {
  NodeSqliteWrapper,
  SQLiteSyncStorage,
  TLSocketRoom,
  type RoomSnapshot,
  type TLSyncSqliteWrapper,
  type WebSocketMinimal,
} from "@tldraw/sync-core";
import {
  DocumentRecordType,
  PageRecordType,
  TLDOCUMENT_ID,
  toRichText,
  type TLPage,
  type TLPageId,
  type TLRecord,
  type TLShape,
} from "@tldraw/tlschema";
import type { RawData, WebSocket } from "ws";
import { errorText, logError } from "../log.ts";
import { LoggedStorage, type ChangeOrigin, type CommittedChange } from "./loggedStorage.ts";
import {
  STARTER_SCENE,
  STARTER_SCENE_AT,
  STARTER_SUBJECT,
  STARTER_SUBJECT_AT,
  SUBJECT_PLACEHOLDER,
} from "./starter.ts";
import { SYNC_TABLE_PREFIX } from "./tables.ts";

/** Records to put (whole, current schema) and ids to remove, in one change. */
export interface CanvasChange {
  readonly put: ReadonlyArray<TLRecord>;
  readonly remove: ReadonlyArray<string>;
}

export interface Applied {
  /** The room clock after the change. */
  readonly clock: number;
  /** The change that puts back what this one replaced or removed. */
  readonly inverse: CanvasChange;
}

/** A change the room refused: a record that fails the schema. */
export class InvalidChange extends Error {}

/** A tab closed this way does not reconnect: tldraw's sync error close code. */
export const SYNC_ERROR_CLOSE = 4099;

const STORAGE_ORIGIN: ChangeOrigin = { kind: "system", id: "storage" };

const initialSnapshot = (): RoomSnapshot => ({
  documentClock: 0,
  tombstoneHistoryStartsAtClock: 0,
  schema: canvasSchema().serialize(),
  documents: [
    { state: DocumentRecordType.create({ id: TLDOCUMENT_ID }), lastChangedClock: 0 },
    { state: PageRecordType.create({ id: "page:page" as TLPageId, name: "Page 1", index: "a1" as TLPage["index"] }), lastChangedClock: 0 },
  ],
});

const frameText = (data: RawData): string =>
  Buffer.isBuffer(data) ? data.toString("utf8") : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data).toString("utf8");

export interface RoomHooks {
  /** Runs after every committed change, outside the transaction. */
  readonly onCommit: (room: CanvasRoom, change: CommittedChange) => void;
  /** Called when the room has had no client and no engine-side call for the idle delay. */
  readonly onIdle: (room: CanvasRoom) => void;
  readonly idleMs: number;
}

/**
 * One project's tldraw sync room over its project database. Every tab of the project is
 * a session; engine-side writes go through `apply`, reach every tab as remote changes,
 * and never enter a tab's undo history.
 */
export class CanvasRoom {
  private readonly tl: TLSocketRoom<TLRecord, void>;
  private readonly storage: LoggedStorage;
  private readonly db: DatabaseSync;
  private currentOrigin: ChangeOrigin = STORAGE_ORIGIN;
  /** The socket each session is on now. A reconnect replaces it before the old one reports its close. */
  private readonly sessionSockets = new Map<string, WebSocket>();
  private readonly sockets = new Set<WebSocket>();
  private inflight = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private closed = false;

  readonly project: string;
  private readonly hooks: RoomHooks;

  constructor(project: string, db: DatabaseSync, hooks: RoomHooks) {
    this.project = project;
    this.hooks = hooks;
    this.db = db;
    const sql = new NodeSqliteWrapper(db, { tablePrefix: SYNC_TABLE_PREFIX }) as unknown as TLSyncSqliteWrapper;
    const fresh = !SQLiteSyncStorage.hasBeenInitialized(sql);
    // A new canvas starts from tldraw's document and page records in this schema.
    const inner = new SQLiteSyncStorage<TLRecord>(fresh ? { sql, snapshot: initialSnapshot() } : { sql });
    this.storage = new LoggedStorage(inner, db, () => this.currentOrigin, (change) => this.hooks.onCommit(this, change));
    this.tl = new TLSocketRoom<TLRecord, void>({
      storage: this.storage,
      schema: canvasSchema(),
      log: { error: (...args: unknown[]) => logError(`canvas ${project}: ${args.map((arg) => errorText(arg)).join(" ")}`) },
    });
    if (fresh) this.seedStarter();
    this.scheduleIdle();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private withOrigin<T>(origin: ChangeOrigin, run: () => T): T {
    const previous = this.currentOrigin;
    this.currentOrigin = origin;
    try {
      return run();
    } finally {
      this.currentOrigin = previous;
    }
  }

  private scheduleIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.closed || this.sockets.size > 0 || this.inflight > 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.sockets.size === 0 && this.inflight === 0) this.hooks.onIdle(this);
    }, this.hooks.idleMs);
    this.idleTimer.unref();
  }

  /** Runs an engine-side call: the room does not idle-close while one is in flight. */
  engineCall<T>(run: () => T): T {
    this.inflight++;
    clearTimeout(this.idleTimer);
    try {
      return run();
    } finally {
      this.inflight--;
      this.scheduleIdle();
    }
  }

  /** Takes a tab's socket. `early` holds any frames it sent before the room was ready. */
  attach(ws: WebSocket, sessionId: string, early: ReadonlyArray<RawData>): void {
    if (this.closed) {
      ws.close(1012, "room closed");
      return;
    }
    this.sockets.add(ws);
    this.sessionSockets.set(sessionId, ws);
    clearTimeout(this.idleTimer);
    const socket: WebSocketMinimal = {
      send: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason),
      get readyState() {
        return ws.readyState;
      },
    };
    this.tl.handleSocketConnect({ sessionId, socket });
    const onMessage = (data: RawData) => {
      if (this.closed || this.sessionSockets.get(sessionId) !== ws) return;
      this.withOrigin({ kind: "session", id: sessionId }, () => this.tl.handleSocketMessage(sessionId, frameText(data)));
    };
    ws.on("message", onMessage);
    ws.on("close", () => {
      this.sockets.delete(ws);
      if (this.sessionSockets.get(sessionId) === ws) {
        this.sessionSockets.delete(sessionId);
        if (!this.closed) this.tl.handleSocketClose(sessionId);
      }
      this.scheduleIdle();
    });
    for (const data of early) onMessage(data);
  }

  /** Every document record in the room. */
  read(): TLRecord[] {
    return this.storage.getSnapshot().documents.map((doc) => doc.state as TLRecord);
  }

  get(id: string): TLRecord | undefined {
    return this.tl.getRecord(id) ?? undefined;
  }

  clock(): number {
    return this.storage.getClock();
  }

  /**
   * Writes a change from the engine. Every connected tab receives it as a remote change.
   * Answers the clock after it and the inverse change. A record that fails the schema
   * refuses the whole change.
   */
  apply(change: CanvasChange, origin: ChangeOrigin): Applied {
    const schema = canvasSchema();
    for (const record of change.put) {
      const type = schema.types[record.typeName as keyof typeof schema.types];
      if (!type) throw new InvalidChange(`There is no record type "${String(record.typeName)}".`);
      try {
        type.validate(record);
      } catch (error) {
        throw new InvalidChange(`${record.id}: ${errorText(error)}`);
      }
    }
    const inverse: { put: TLRecord[]; remove: string[] } = { put: [], remove: [] };
    const result = this.withOrigin(origin, () =>
      this.storage.transaction((txn) => {
        for (const record of change.put) {
          const before = txn.get(record.id);
          if (before) inverse.put.push(before);
          else inverse.remove.push(record.id);
          txn.set(record.id, record);
        }
        for (const id of change.remove) {
          const before = txn.get(id);
          if (!before) continue;
          inverse.put.push(before);
          txn.delete(id);
        }
      }),
    );
    return { clock: result.documentClock, inverse };
  }

  /** The ids among `recordIds` that a tab changed after `clock`. Engine-side changes do not count. */
  changedSince(recordIds: ReadonlyArray<string>, clock: number): string[] {
    const wanted = new Set(recordIds);
    const changed = new Set<string>();
    const rows = this.db
      .prepare("SELECT put, removed FROM canvas_changes WHERE clock > ? AND origin_kind = 'session' ORDER BY clock")
      .all(clock);
    for (const row of rows) {
      for (const id of [...(JSON.parse(String(row.put)) as string[]), ...(JSON.parse(String(row.removed)) as string[])]) {
        if (wanted.has(id)) changed.add(id);
      }
    }
    return recordIds.filter((id) => changed.has(id));
  }

  /** Flushes storage, then disconnects every tab. The room cannot be used afterwards. */
  close(code = 1001, reason = "closing"): void {
    if (this.closed) return;
    clearTimeout(this.idleTimer);
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      logError(`canvas ${this.project}: could not flush: ${errorText(error)}`);
    }
    this.closed = true;
    for (const ws of this.sockets) ws.close(code, reason);
    this.sockets.clear();
    this.sessionSockets.clear();
    this.tl.close();
  }

  private seedStarter(): void {
    const records = this.read();
    const page = records.find((record) => record.typeName === "page");
    if (!page) return;
    const subjectRef = nextRef(records);
    const sceneRef = nextRef([...records, { typeName: "shape", type: "text", meta: { ref: subjectRef } }]);
    const prompt = (id: string, at: { x: number; y: number }, index: string, ref: string, text: string): TLShape =>
      ({
        id,
        typeName: "shape",
        type: "text",
        x: at.x,
        y: at.y,
        rotation: 0,
        index,
        parentId: page.id,
        isLocked: false,
        opacity: 1,
        props: {
          color: "black",
          size: "s",
          w: 320,
          font: "sans",
          textAlign: "start",
          autoSize: false,
          scale: 1,
          richText: toRichText(text),
        },
        meta: { ref },
      }) as unknown as TLShape;
    this.apply(
      {
        put: [
          prompt("shape:starter-scene", STARTER_SCENE_AT, "a1", sceneRef, STARTER_SCENE.replace(SUBJECT_PLACEHOLDER, `@${subjectRef}`)),
          prompt("shape:starter-subject", STARTER_SUBJECT_AT, "a2", subjectRef, STARTER_SUBJECT),
        ],
        remove: [],
      },
      { kind: "system", id: "starter" },
    );
  }

  /**
   * The shapes this change gave a ref another shape held first. A shape whose ref the
   * change left alone held it first; among the ones it gave a ref, an updated shape comes
   * before a created one.
   */
  refCollisions(change: CommittedChange): TLShape[] {
    if (change.refChanged.length === 0) return [];
    const shapes = this.read().filter((record): record is TLShape => record.typeName === "shape");
    const byId = new Map(shapes.map((shape) => [shape.id as string, shape]));
    const created = new Set(change.created);
    const renamed = new Set(change.refChanged);
    const order = [
      ...shapes.filter((shape) => !renamed.has(shape.id)).map((shape) => shape.id as string),
      ...change.refChanged.filter((id) => !created.has(id)),
      ...change.refChanged.filter((id) => created.has(id)),
    ];
    const claimed = new Map<string, string>();
    const colliding: TLShape[] = [];
    for (const id of order) {
      const shape = byId.get(id);
      const ref = shape && readRef(shape);
      if (!shape || ref === undefined) continue;
      if (!claimed.has(ref)) claimed.set(ref, id);
      else if (renamed.has(id)) colliding.push(shape);
    }
    return colliding;
  }
}
