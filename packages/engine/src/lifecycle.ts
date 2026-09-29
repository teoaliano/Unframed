/**
 * The changes that could strand paid work (spec 10): a settings update (spec 01's rules
 * with spec 10's steps inserted), removing the key, and renaming or deleting a project.
 * Each reads the job store strictly, touches the job records first and takes the
 * destructive step last, compensating when a later step fails. They run one at a time.
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Settings, SettingsPatch } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { normaliseSettingsPatch } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { errorText, logError, logInfo } from "./log.ts";
import { OAuth } from "./oauth/oauth.ts";
import { OpenProjects } from "./openProjects.ts";
import { resolveOutputDir } from "./paths.ts";
import { Config } from "./services.ts";
import { SettingsStore } from "./settingsStore.ts";
import { copyPendingJobsTo, dropPendingJobsIn } from "./video/jobLifecycle.ts";
import { RenderJobs } from "./video/renderJobs.ts";

export const KEY_REMOVED_ERROR =
  "Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.";

export const MOVED_WHILE_REMOVED_ERROR = "The OpenRouter key was removed while this render was being moved to a new folder.";

/** Two spellings of one directory: same device and inode. A folder that cannot be read is no match. */
const sameDirectory = async (a: string, b: string): Promise<boolean> => {
  try {
    const [first, second] = await Promise.all([stat(a), stat(b)]);
    return first.dev === second.dev && first.ino === second.ino;
  } catch {
    return false;
  }
};

interface FolderMove {
  readonly from: string;
  readonly to: string;
  /** The folder as `.env` spells it. */
  readonly written: string;
}

export interface RemovedKey {
  readonly settings: Settings;
  readonly endedRenders: number;
  readonly renderCleanupError?: string;
}

export class Lifecycle extends Context.Service<
  Lifecycle,
  {
    readonly updateSettings: (patch: SettingsPatch) => Effect.Effect<Settings, UnframedError>;
    /** Removing a key is a security action: it stands even when the job store cannot be read. */
    readonly removeKey: Effect.Effect<RemovedKey, UnframedError>;
  }
>()("unframed/engine/Lifecycle") {}

export const lifecycleLayer = Layer.effect(
  Lifecycle,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const oauth = yield* OAuth;
    const renderJobs = yield* RenderJobs;
    const openProjects = yield* OpenProjects;
    const lock = yield* Semaphore.make(1);

    const writeEnv = (changes: Readonly<Record<string, string | null>>, options?: { readonly holdOutputDir?: boolean }) =>
      Effect.mapError(settings.write(changes, options), (error) => unframedError("internal", `Could not write .env: ${error.reason}`));

    const applyChanges = (changes: Readonly<Record<string, string | null>>) =>
      Effect.gen(function* () {
        const outputDir = changes.OUTPUT_DIR;
        let move: FolderMove | undefined;
        if (typeof outputDir === "string") {
          const to = resolveOutputDir(outputDir, config.dataDir);
          const from = yield* settings.outputDir;
          yield* Effect.tryPromise({
            try: () => mkdir(to, { recursive: true }),
            catch: (error) => unframedError("bad_request", `Cannot use that folder: ${errorText(error)}`),
          });
          if (!(yield* Effect.promise(() => sameDirectory(from, to)))) move = { from, to, written: outputDir };
        }
        if (move !== undefined) return yield* moveOutputDir(changes, move);
        yield* writeEnv(changes);
        yield* settings.emit;
        return yield* settings.view;
      });

    /**
     * The strip is the commit point and comes last, so no failing step loses a record: the
     * worst a failure leaves is a duplicate in a store nothing reads. A render created
     * between the copy's read and the `.env` commit stays behind in the old store; a tab
     * watching it still collects it through spec 04's poll fallback.
     */
    const moveOutputDir = (changes: Readonly<Record<string, string | null>>, move: FolderMove) =>
      Effect.gen(function* () {
        const copied = yield* Effect.tryPromise({
          try: () => copyPendingJobsTo(move.from, move.to),
          catch: (error) =>
            unframedError("internal", `Could not move the renders already in progress to that folder, so the folder was not changed: ${errorText(error)}`),
        });
        const rollBack = Effect.promise(() =>
          copied.length === 0
            ? Promise.resolve()
            : dropPendingJobsIn(move.to, copied).catch((error: unknown) => logError(`could not roll back copied jobs: ${errorText(error)}`)),
        );
        yield* writeEnv(changes, { holdOutputDir: true }).pipe(Effect.tapError(() => rollBack));

        // Every committed change is already on disk, so a closer that fails does not stop the move.
        for (const failure of yield* openProjects.closeAll) {
          logError(`could not flush ${join(move.from, failure.project)} before changing the output folder: ${failure.reason}`);
        }
        // From here the new store is the one the sweep reads.
        yield* settings.useOutputDir(move.written);

        if (copied.length > 0 && (yield* settings.read).key === "") {
          // A key removal that ran during the move failed only the old store it could see.
          yield* renderJobs
            .failPending({ ids: copied, error: MOVED_WHILE_REMOVED_ERROR })
            .pipe(Effect.catch((error) => Effect.sync(() => logError(`could not stop the moved renders: ${error.reason}`))));
        }
        if (copied.length > 0) {
          yield* Effect.promise(() =>
            dropPendingJobsIn(move.from, copied).then(
              () => logInfo(`moved ${copied.length} pending video job(s) to the new output folder`),
              (error: unknown) => logError(`left ${copied.length} job record(s) behind in the old folder: ${errorText(error)}`),
            ),
          );
        }
        yield* settings.emit;
        return yield* settings.view;
      });

    const updateSettings = (patch: SettingsPatch) =>
      Effect.gen(function* () {
        const normalised = normaliseSettingsPatch(patch);
        if (!normalised.ok) return yield* unframedError("bad_request", normalised.message);
        const { changes } = normalised;
        // Right after validation, before anything that waits (the lock included): a save
        // made just before a Connect must not cancel the attempt that Connect created after.
        if ("OPENROUTER_API_KEY" in changes) yield* oauth.cancelAttempt;
        return yield* applyChanges(changes).pipe(lock.withPermits(1));
      });

    const removeKeyLocked = Effect.gen(function* () {
      // A delete, not an empty line, so a key the shell environment provides is not shadowed.
      yield* writeEnv({ OPENROUTER_API_KEY: null });
      yield* settings.emit;
      const view = yield* settings.view;
      // The sweep cannot poll without a key, so pending renders would sit stranded for 24 hours.
      return yield* renderJobs.failPending({ error: KEY_REMOVED_ERROR }).pipe(
        Effect.map((endedRenders): RemovedKey => ({ settings: view, endedRenders })),
        Effect.catch((error) =>
          Effect.succeed<RemovedKey>({
            settings: view,
            endedRenders: 0,
            renderCleanupError: `The key was removed, but renders already in progress could not be stopped: ${error.reason}`,
          }),
        ),
      );
    });

    // The attempt is cancelled first, outside the lock: the key is being removed anyway.
    const removeKey = Effect.andThen(oauth.cancelAttempt, removeKeyLocked.pipe(lock.withPermits(1)));

    return Lifecycle.of({ updateSettings, removeKey });
  }),
);
