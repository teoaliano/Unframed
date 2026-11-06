import { settleTokens } from "./kits/tokensFile.ts";
import { lstat, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Settings, SettingsPatch } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { ELEVENLABS_KEY, normaliseSettingsPatch, projectSlug, VERCEL_KEY } from "@unframed/domain";
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
import { copyPendingJobsTo, dropPendingJobsIn, readPendingJobs, reassignPendingJobsIn } from "./video/jobLifecycle.ts";
import { Runs } from "./runs/runs.ts";
import { RenderJobs } from "./video/renderJobs.ts";

const KEY_REMOVED_ERROR =
  "Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.";

const PROJECT_DELETED_ERROR =
  "Stopped tracking this render: the project it belonged to was deleted. It may still finish upstream, but nothing here will save the result.";

const MOVED_WHILE_REMOVED_ERROR = "The OpenRouter key was removed while this render was being moved to a new folder.";

const sameDirectory = async (a: string, b: string): Promise<boolean> => {
  try {
    const [first, second] = await Promise.all([stat(a), stat(b)]);
    return first.dev === second.dev && first.ino === second.ino;
  } catch {
    return false;
  }
};

const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);

interface FolderMove {
  readonly from: string;
  readonly to: string;
  readonly written: string;
}

interface RemovedKey {
  readonly settings: Settings;
  readonly endedRenders: number;
  readonly renderCleanupError?: string;
}

export class Lifecycle extends Context.Service<
  Lifecycle,
  {
    readonly updateSettings: (patch: SettingsPatch) => Effect.Effect<Settings, UnframedError>;
    readonly removeKey: Effect.Effect<RemovedKey, UnframedError>;
    readonly removeElevenLabsKey: Effect.Effect<{ settings: Settings }, UnframedError>;
    readonly removeVercelKey: Effect.Effect<{ settings: Settings }, UnframedError>;
    readonly cancelConnection: Effect.Effect<Omit<RemovedKey, "settings">, UnframedError>;
    readonly renameProject: (name: string, to: string) => Effect.Effect<{ name: string; movedRenders: number }, UnframedError>;
    readonly deleteProject: (name: string, confirmRenders: boolean) => Effect.Effect<{ endedRenders: number }, UnframedError>;
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
    const runs = yield* Runs;
    const lock = yield* Semaphore.make(1);

    const refuseLiveRuns = (project?: string) =>
      Effect.flatMap(runs.liveRuns(project), (count) =>
        count === 0
          ? Effect.void
          : Effect.fail(
              unframedError("conflict", `Wait for the ${count} run${count === 1 ? "" : "s"} still generating in this project to finish, then try again.`, { liveRuns: count }),
            ),
      );

    const published = Effect.andThen(settings.emit, settings.view);

    const writeEnv = (changes: Readonly<Record<string, string | null>>, options?: { readonly holdOutputDir?: boolean }) =>
      Effect.mapError(settings.write(changes, options), (error) => unframedError("internal", `Could not write .env: ${error.reason}`));

    const applyChanges = (changes: Readonly<Record<string, string | null>>) =>
      Effect.gen(function* () {
        const outputDir = changes.OUTPUT_DIR;
        let move: FolderMove | undefined;
        if (typeof outputDir === "string") {
          const to = resolveOutputDir(outputDir, config.dataDir);
          const from = yield* settings.outputDir;
          if (to !== from) yield* refuseLiveRuns();
          yield* Effect.tryPromise({
            try: () => mkdir(to, { recursive: true }),
            catch: (error) => unframedError("bad_request", `Cannot use that folder: ${errorText(error)}`),
          });
          if (!(yield* Effect.promise(() => sameDirectory(from, to)))) move = { from, to, written: outputDir };
        }
        if (move !== undefined) return yield* moveOutputDir(changes, move);
        yield* writeEnv(changes);
        return yield* published;
      });

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

        for (const failure of yield* openProjects.closeAll) {
          logError(`could not flush ${join(move.from, failure.project)} before changing the output folder: ${failure.reason}`);
        }
        yield* settings.useOutputDir(move.written);

        if (copied.length > 0 && (yield* settings.read).key === "") {
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
        return yield* published;
      });

    const updateSettings = (patch: SettingsPatch) =>
      Effect.gen(function* () {
        const normalised = normaliseSettingsPatch(patch);
        if (!normalised.ok) return yield* unframedError("bad_request", normalised.message);
        const { changes } = normalised;
        if ("OPENROUTER_API_KEY" in changes) yield* oauth.cancelAttempt;
        return yield* applyChanges(changes).pipe(lock.withPermits(1));
      });

    const removeKeyLine = (writeFailure: (reason: string) => string) =>
      Effect.gen(function* () {
        yield* Effect.mapError(settings.write({ OPENROUTER_API_KEY: null }), (error) => unframedError("internal", writeFailure(error.reason)));
        const view = yield* published;
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

    const removeKey = Effect.andThen(oauth.cancelAttempt, removeKeyLine((reason) => `Could not write .env: ${reason}`).pipe(lock.withPermits(1)));

    const removeElevenLabsKey = Effect.gen(function* () {
      yield* writeEnv({ [ELEVENLABS_KEY.variable]: null });
      return { settings: yield* published };
    }).pipe(lock.withPermits(1));

    const removeVercelKey = Effect.gen(function* () {
      yield* writeEnv({ [VERCEL_KEY.variable]: null });
      return { settings: yield* published };
    }).pipe(lock.withPermits(1));

    const cancelConnection = Effect.flatMap(oauth.cancelAttempt, (wrote) =>
      wrote
        ? removeKeyLine((reason) => `Could not remove the key the cancelled connection had written: ${reason}`).pipe(
            lock.withPermits(1),
            Effect.map(({ settings: _settings, ...ended }) => ended),
          )
        : Effect.succeed({ endedRenders: 0 }),
    );

    const closeProject = (project: string) =>
      Effect.flatMap(openProjects.close(project), (failures) =>
        Effect.sync(() => {
          for (const failure of failures) logError(`could not close ${failure.name} of ${failure.project}: ${failure.reason}`);
        }),
      );

    const projectFolder = (slug: string) =>
      Effect.gen(function* () {
        if (slug === "") return yield* unframedError("not_found", 'There is no project named "".');
        return join(yield* settings.outputDir, slug);
      });

    const renameProject = (name: string, target: string) =>
      Effect.gen(function* () {
        const from = projectSlug(name);
        const to = projectSlug(target);
        yield* refuseLiveRuns(from);
        if (to === "") return yield* unframedError("bad_request", "New name is empty.");
        const folder = yield* projectFolder(from);
        const outputDir = yield* settings.outputDir;
        const destination = join(outputDir, to);
        if (yield* Effect.promise(() => exists(destination))) return yield* unframedError("conflict", `A project named "${to}" already exists.`);

        const moved = yield* Effect.tryPromise({
          try: () => reassignPendingJobsIn(outputDir, from, to),
          catch: (error) => unframedError("internal", `Could not update the renders in progress for this project, so it was not renamed: ${errorText(error)}`),
        });
        yield* closeProject(from);
        const renamed = yield* Effect.promise(() => rename(folder, destination).then(() => undefined, (error: unknown) => errorText(error)));
        if (renamed !== undefined) {
          const restored = yield* Effect.promise(() =>
            moved === 0 ? Promise.resolve(undefined) : reassignPendingJobsIn(outputDir, to, from).then(() => undefined, (error: unknown) => errorText(error)),
          );
          if (restored === undefined) return yield* unframedError("internal", `Could not rename: ${renamed}`);
          logError(`could not restore job records after a failed rename: ${restored}`);
          return yield* unframedError(
            "internal",
            `Could not rename (${renamed}), and ${moved} render(s) in progress are now recorded under "${to}". Renaming the project to "${to}" by hand will reunite them.`,
          );
        }
        return { name: to, movedRenders: moved };
      }).pipe(lock.withPermits(1));

    const deleteProject = (name: string, confirmRenders: boolean) =>
      Effect.gen(function* () {
        const slug = projectSlug(name);
        yield* refuseLiveRuns(slug);
        const folder = yield* projectFolder(slug);
        const outputDir = yield* settings.outputDir;
        const pending = yield* Effect.tryPromise({
          try: () => readPendingJobs(outputDir, slug),
          catch: (error) => unframedError("internal", `Could not check whether this project has renders in progress, so nothing was deleted: ${errorText(error)}`),
        });
        if (pending.length > 0 && !confirmRenders) {
          return yield* unframedError("conflict", `This project has ${pending.length} video render${pending.length === 1 ? "" : "s"} in progress.`, {
            pendingRenders: pending.length,
          });
        }
        const ended =
          pending.length === 0
            ? 0
            : yield* renderJobs
                .failPending({ project: slug, error: PROJECT_DELETED_ERROR })
                .pipe(Effect.mapError((error) => unframedError("internal", `Could not stop the renders in progress, so the project was not deleted: ${error.reason}`)));
        yield* closeProject(slug);
        yield* Effect.promise(() => settleTokens());
        const removed = yield* Effect.promise(() => rm(folder, { recursive: true, force: true }).then(() => undefined, (error: unknown) => errorText(error)));
        if (removed !== undefined) {
          return yield* unframedError(
            "internal",
            ended > 0 ? `Stopped ${ended} render(s), but the project folder could not be deleted: ${removed}. Deleting again is safe.` : `Could not delete the project: ${removed}`,
          );
        }
        return { endedRenders: ended };
      }).pipe(lock.withPermits(1));

    return Lifecycle.of({ updateSettings, removeKey, removeElevenLabsKey, removeVercelKey, cancelConnection, renameProject, deleteProject });
  }),
);
