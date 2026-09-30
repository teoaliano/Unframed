import { stat } from "node:fs/promises";
import type http from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { UnframedError, unframedError } from "@unframed/contracts";
import { MAX_REQUEST_BYTES, nextRef, projectSlug } from "@unframed/domain";
import type { TLRecord, TLShape } from "@tldraw/tlschema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { UpgradeRoute } from "../http/api.ts";
import { errorText, logError } from "../log.ts";
import { OpenProjects } from "../openProjects.ts";
import { ProjectDatabase } from "../projectDatabase.ts";
import { SettingsStore } from "../settingsStore.ts";
import type { ChangeOrigin, CommittedChange } from "./loggedStorage.ts";
import { CanvasRoom, InvalidChange, SYNC_ERROR_CLOSE, type Applied, type CanvasChange, type ChangeLogRow } from "./room.ts";

export type { Applied, CanvasChange, ChangeLogRow, ChangeOrigin, CommittedChange };

/** How long a room stays open after its last tab leaves. */
export const ROOM_IDLE_MS = 60_000;

const SYNC_PATH = /^\/sync\/([^/]+)$/;

/** What work handed off by a room may do with it, while it is open. */
export interface RoomAccess {
  readonly get: (id: string) => TLRecord | undefined;
  readonly read: () => ReadonlyArray<TLRecord>;
  /** Puts records with origin `system` (media rewriting). */
  readonly apply: (put: TLRecord[]) => void;
  readonly change: (change: CanvasChange, origin: ChangeOrigin) => void;
}

/** Work the room hands off after a commit: media rewriting (media store), run marker resolution (runs). */
export type AfterCommit = (project: string, change: CommittedChange, room: RoomAccess) => void;

/** Work that runs once when a room opens, before any tab or call uses it: run marker resolution. */
export type AfterOpen = (project: string, room: RoomAccess) => void;

/**
 * The canvas rooms: one tldraw sync room per project, opened on the first tab or the
 * first engine-side call, closed 60 seconds after the last tab leaves. `apply` is the
 * only way the engine changes a canvas.
 */
export class CanvasRooms extends Context.Service<
  CanvasRooms,
  {
    /** The sync socket at `/sync/<project>?sessionId=<id>`. */
    readonly upgrade: UpgradeRoute;
    readonly read: (project: string) => Effect.Effect<ReadonlyArray<TLRecord>, UnframedError>;
    /** The room clock: it counts every committed change. */
    readonly clock: (project: string) => Effect.Effect<number, UnframedError>;
    readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Effect.Effect<Applied, UnframedError>;
    /** The ids among `recordIds` a tab changed after `clock`. */
    readonly changedSince: (project: string, recordIds: ReadonlyArray<string>, clock: number) => Effect.Effect<ReadonlyArray<string>, UnframedError>;
    /** Every change log row after `clock`, with its origin (spec 07 reads the log through this). */
    readonly changeLog: (project: string, clock: number) => Effect.Effect<ReadonlyArray<ChangeLogRow>, UnframedError>;
    readonly close: (project: string) => Effect.Effect<void>;
    /** Closes every tab's socket with `code`, for shutdown. */
    readonly closeSockets: (code: number) => Promise<void>;
    /** Registers the work that runs after each committed change (media rewriting). */
    readonly afterCommit: (hook: AfterCommit) => Effect.Effect<void>;
    readonly afterOpen: (hook: AfterOpen) => Effect.Effect<void>;
  }
>()("unframed/engine/CanvasRooms") {}

const isDirectory = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

export const canvasRoomsLayer = Layer.effect(
  CanvasRooms,
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const database = yield* ProjectDatabase;
    const openProjects = yield* OpenProjects;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    const rooms = new Map<string, CanvasRoom>();
    const forget = new Map<CanvasRoom, () => void>();
    const hooks: AfterCommit[] = [];
    const openHooks: AfterOpen[] = [];

    const access = (room: CanvasRoom): RoomAccess => ({
      get: (id) => (room.isClosed ? undefined : room.get(id)),
      read: () => (room.isClosed ? [] : room.read()),
      apply: (put) => {
        if (!room.isClosed) room.apply({ put, remove: [] }, { kind: "system", id: "media" });
      },
      change: (change, origin) => {
        if (!room.isClosed) room.apply(change, origin);
      },
    });

    const closeRoom = (room: CanvasRoom, code?: number, reason?: string) => {
      room.close(code, reason);
      if (rooms.get(room.project) === room) rooms.delete(room.project);
      forget.get(room)?.();
      forget.delete(room);
    };

    const repairRefs = (room: CanvasRoom, change: CommittedChange) => {
      const colliding = room.refCollisions(change);
      if (colliding.length === 0) return;
      const records: Array<{ typeName?: string; type?: string; props?: unknown; meta?: unknown }> = [...room.read()];
      const put: TLShape[] = [];
      for (const shape of colliding) {
        const ref = nextRef(records);
        const renamed =
          shape.type === "frame"
            ? ({ ...shape, props: { ...shape.props, name: ref } } as TLShape)
            : ({ ...shape, meta: { ...shape.meta, ref } } as TLShape);
        records.push(renamed);
        put.push(renamed);
      }
      room.apply({ put, remove: [] }, { kind: "system", id: "repair" });
    };

    const onCommit = (room: CanvasRoom, change: CommittedChange) => {
      if (change.origin.kind === "system") return;
      queueMicrotask(() => {
        if (room.isClosed) return;
        try {
          repairRefs(room, change);
        } catch (error) {
          logError(`canvas ${room.project}: could not repair refs: ${errorText(error)}`);
        }
        for (const hook of hooks) {
          try {
            hook(room.project, change, access(room));
          } catch (error) {
            logError(`canvas ${room.project}: ${errorText(error)}`);
          }
        }
      });
    };

    const projectFolder = (name: string) =>
      Effect.gen(function* () {
        const slug = projectSlug(name);
        const folder = slug === "" ? undefined : join(yield* settings.outputDir, slug);
        const exists = folder !== undefined && (yield* Effect.promise(() => isDirectory(folder)));
        return exists ? slug : undefined;
      });

    const openRoom = (slug: string): Effect.Effect<CanvasRoom, UnframedError> =>
      Effect.gen(function* () {
        const live = rooms.get(slug);
        if (live && !live.isClosed) return live;
        const handle = yield* database.open(slug);
        // One synchronous step from the check to the map, so two tabs never make two rooms.
        const { room, created } = yield* Effect.try({
          try: () => {
            const existing = rooms.get(slug);
            if (existing && !existing.isClosed) return { room: existing, created: false };
            const made = new CanvasRoom(slug, handle.db, {
              onCommit,
              onIdle: (idle) => closeRoom(idle),
              idleMs: ROOM_IDLE_MS,
            });
            rooms.set(slug, made);
            return { room: made, created: true };
          },
          catch: (error) => unframedError("internal", `Could not open the canvas: ${errorText(error)}`),
        });
        if (created) {
          forget.set(
            room,
            yield* openProjects.register(slug, "canvas room", Effect.sync(() => closeRoom(room, 1012, "project closed"))),
          );
          for (const hook of openHooks) {
            try {
              room.engineCall(() => hook(slug, access(room)));
            } catch (error) {
              logError(`canvas ${slug}: ${errorText(error)}`);
            }
          }
        }
        return room;
      });

    const roomFor = (project: string) =>
      Effect.gen(function* () {
        const slug = yield* projectFolder(project);
        if (slug === undefined) return yield* unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
        return yield* openRoom(slug);
      });

    const engineCall = <A>(project: string, run: (room: CanvasRoom) => A) =>
      Effect.flatMap(roomFor(project), (room) =>
        Effect.try({
          try: () => room.engineCall(() => run(room)),
          catch: (error) =>
            error instanceof InvalidChange
              ? unframedError("bad_request", `That canvas change is not valid: ${error.message}`)
              : unframedError("internal", `Could not change the canvas: ${errorText(error)}`),
        }),
      );

    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_REQUEST_BYTES, perMessageDeflate: false });
    const allSockets = new Set<WebSocket>();

    const onSocket = (ws: WebSocket, project: string, sessionId: string | null) => {
      allSockets.add(ws);
      ws.on("close", () => allSockets.delete(ws));
      ws.on("error", () => {});
      // The client speaks as soon as the socket opens; hold its frames until the room is ready.
      const early: RawData[] = [];
      const hold = (data: RawData) => early.push(data);
      ws.on("message", hold);
      void runPromise(
        Effect.gen(function* () {
          const slug = yield* projectFolder(project);
          if (slug === undefined) {
            ws.close(SYNC_ERROR_CLOSE, "unknown project");
            return;
          }
          if (!sessionId) {
            ws.close(SYNC_ERROR_CLOSE, "missing sessionId");
            return;
          }
          const room = yield* openRoom(slug);
          ws.off("message", hold);
          if (ws.readyState !== ws.OPEN) return;
          room.attach(ws, sessionId, early);
        }).pipe(
          Effect.catch((error: UnframedError) =>
            Effect.sync(() => {
              logError(`canvas ${project}: ${error.message}`);
              ws.close(SYNC_ERROR_CLOSE, error.message.slice(0, 120));
            }),
          ),
        ),
      );
    };

    const upgrade: UpgradeRoute = (req: http.IncomingMessage, socket: Duplex, head: Buffer, url: URL) => {
      const match = SYNC_PATH.exec(url.pathname);
      if (!match) return false;
      let project: string;
      try {
        project = decodeURIComponent(match[1]!);
      } catch {
        project = "";
      }
      const sessionId = url.searchParams.get("sessionId");
      wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, project, sessionId));
      return true;
    };

    const closeSockets = async (code: number) => {
      await Promise.all(
        [...allSockets].map(
          (ws) =>
            new Promise<void>((resolve) => {
              if (ws.readyState === ws.CLOSED) return resolve();
              const timer = setTimeout(() => {
                ws.terminate();
                resolve();
              }, 250);
              ws.once("close", () => {
                clearTimeout(timer);
                resolve();
              });
              ws.close(code);
            }),
        ),
      );
    };

    return CanvasRooms.of({
      upgrade,
      read: (project) => engineCall(project, (room) => room.read()),
      clock: (project) => engineCall(project, (room) => room.clock()),
      apply: (project, change, origin) => engineCall(project, (room) => room.apply(change, origin)),
      changedSince: (project, recordIds, clock) => engineCall(project, (room) => room.changedSince(recordIds, clock)),
      changeLog: (project, clock) => engineCall(project, (room) => room.changeLog(clock)),
      close: (project) =>
        Effect.sync(() => {
          const room = rooms.get(projectSlug(project));
          if (room) closeRoom(room, 1012, "project closed");
        }),
      closeSockets,
      afterCommit: (hook) => Effect.sync(() => void hooks.push(hook)),
      afterOpen: (hook) => Effect.sync(() => void openHooks.push(hook)),
    });
  }),
);
