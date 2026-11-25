import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { UnframedError, unframedError, type Instance, type InstanceState, type RepositorySetup } from "@unframed/contracts";
import {
  INSTANCE_IDLE_MS,
  INSTANCE_NOT_FOUND,
  INSTANCE_REMOVED,
  NO_RUN_COMMAND,
  NOT_A_REPOSITORY_PROJECT,
  REPOSITORY_NOT_FOUND,
  appendLogTail,
  badBranchName,
  branchTaken,
  copiedEnvFiles,
  countsAsChange,
  defaultInstanceBranch,
  evictionsOverBudget,
  idleToStop,
  instanceMemoryBudget,
  exitedBeforeListening,
  inferredSetup,
  listenedPorts,
  mergeExclude,
  movedPort,
  neverListened,
  proxyFailed,
  packageScripts,
  parseProcessTable,
  portInUse,
  processTreeRss,
  projectSlug,
  serverExited,
  setupFailed,
  setupFileMissing,
  setupFileOutside,
  setupFilePath,
  setupFileTracked,
  shapeRunCommand,
  singlePortMoved,
  stoppedForBudget,
  stoppedWhenIdle,
  uncommittedWork,
  unknownBase,
  unsavedWork,
  worktreePath,
} from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { errorText } from "../log.ts";
import { LoginShell } from "../loginShell.ts";
import { ProjectDatabase } from "../projectDatabase.ts";
import { Projects } from "../projects.ts";
import { makeGit, gitOutput, gitStdout } from "../repositories/git.ts";
import { readRepository, readRepositoryProject, writeRepository, type StoredRepository } from "../repositories/tables.ts";
import { Config } from "../services.ts";
import { Shutdown } from "../shutdown.ts";
import { answers, freePort, spawnTracked, stopTracked, sweepLeftovers, type Tracked } from "./processes.ts";
import { startInstanceProxy, type InstanceProxy } from "./proxy.ts";
import { insertInstance, markInstalled, markRemoved, readInstances, type StoredInstance } from "./tables.ts";

const LOG_TAIL_CHARS = 16_000;
const LOG_PUBLISH_MS = 500;
const START_TIMEOUT_MS = 120_000;
const PROBE_EVERY_MS = 150;
const PORT_RELEASE_MS = 3_000;
const STOP_GRACE_MS = 3_000;
const SHUTDOWN_GRACE_MS = 1_500;
const SETUP_FILES_FOLDER = "setup-files";
const SAMPLE_EVERY_MS = 15_000;

export interface CreateOptions {
  readonly base?: string;
  readonly branch?: string;
}

export interface RemoveOptions {
  readonly force?: boolean;
  readonly deleteBranch?: boolean;
}

export class Instances extends Context.Service<
  Instances,
  {
    readonly create: (project: string, options: CreateOptions) => Effect.Effect<Instance, UnframedError>;
    readonly remove: (project: string, id: string, options: RemoveOptions) => Effect.Effect<Instance, UnframedError>;
    readonly list: (project: string) => Effect.Effect<ReadonlyArray<Instance>, UnframedError>;
    readonly status: (project: string, id: string) => Effect.Effect<Instance, UnframedError>;
    readonly start: (project: string, id: string) => Effect.Effect<Instance, UnframedError>;
    readonly stop: (project: string, id: string) => Effect.Effect<Instance, UnframedError>;
    readonly demand: (project: string, client: string, ids: ReadonlyArray<string>, connection?: string) => Effect.Effect<ReadonlyArray<Instance>, UnframedError>;
    readonly release: (connection: string) => Effect.Effect<void>;
    readonly branches: (project: string) => Effect.Effect<{ readonly branches: ReadonlyArray<string>; readonly current: string }, UnframedError>;
    readonly saveSetup: (project: string, setup: RepositorySetup, from: string) => Effect.Effect<{ readonly copiedInto: ReadonlyArray<string> }, UnframedError>;
    readonly everyChange: Stream.Stream<Instance>;
    readonly changes: (project: string) => Stream.Stream<Instance, UnframedError>;
  }
>()("unframed/engine/Instances") {}

interface Live {
  readonly project: string;
  stored: StoredInstance;
  state: InstanceState;
  upstreamPort: number | null;
  reservedPort: number | null;
  error: string | null;
  log: string;
  process: Tracked | undefined;
  proxy: InstanceProxy | undefined;
  lastProxyPort: number | null;
  watcher: FSWatcher | undefined;
  demandOrder: number;
  lastDemandedAt: number;
  lastChangeAt: number;
  rss: number;
  suppressed: boolean;
  retry: boolean;
  stopping: boolean;
  queue: Promise<unknown>;
  logTimer: NodeJS.Timeout | undefined;
}

interface RepositoryContext {
  readonly slug: string;
  readonly repository: StoredRepository;
  readonly db: DatabaseSync;
}

const isRemoved = (live: Live): boolean => live.state === "removed";

const fileExists = (path: string): Promise<boolean> => stat(path).then((info) => info.isFile(), () => false);

export const instancesLayer = Layer.effect(
  Instances,
  Effect.gen(function* () {
    const config = yield* Config;
    const database = yield* ProjectDatabase;
    const projects = yield* Projects;
    const loginShell = yield* LoginShell;
    const shutdown = yield* Shutdown;
    const git = makeGit(loginShell);
    const events = yield* PubSub.unbounded<Instance>();
    const pidDir = join(config.dataDir, "instance-pids");
    sweepLeftovers(pidDir);

    const lives = new Map<string, Live>();
    const loaded = new Set<string>();
    const keyOf = (project: string, id: string) => `${project}/${id}`;

    const view = (live: Live): Instance => ({
      id: live.stored.id,
      repository: live.project,
      branch: live.stored.branch,
      baseRef: live.stored.baseRef,
      worktree: live.stored.worktree,
      state: live.state,
      proxyPort: live.proxy?.port ?? null,
      upstreamPort: live.upstreamPort,
      error: live.error,
      log: live.log,
    });

    const publish = (live: Live) => {
      Effect.runSync(PubSub.publish(events, view(live)));
    };

    const setState = (live: Live, state: InstanceState, patch: Partial<Pick<Live, "upstreamPort" | "error">> = {}) => {
      live.state = state;
      if (patch.upstreamPort !== undefined) live.upstreamPort = patch.upstreamPort;
      if (patch.error !== undefined) live.error = patch.error;
      publish(live);
    };

    const appendLog = (live: Live, chunk: string) => {
      live.log = appendLogTail(live.log, chunk, LOG_TAIL_CHARS);
      if (live.logTimer !== undefined) return;
      live.logTimer = setTimeout(() => {
        live.logTimer = undefined;
        publish(live);
      }, LOG_PUBLISH_MS);
      live.logTimer.unref();
    };

    const enqueue = <A>(live: Live, run: Effect.Effect<A>): Promise<A> => {
      const next = live.queue.then(() => Effect.runPromise(run));
      live.queue = next.catch(() => undefined);
      return next;
    };

    const fresh = (project: string, stored: StoredInstance, state: InstanceState): Live => ({
      project,
      stored,
      state,
      upstreamPort: null,
      reservedPort: null,
      error: null,
      log: "",
      process: undefined,
      proxy: undefined,
      lastProxyPort: null,
      watcher: undefined,
      demandOrder: 0,
      lastDemandedAt: 0,
      lastChangeAt: 0,
      rss: 0,
      suppressed: false,
      retry: false,
      stopping: false,
      queue: Promise.resolve(),
      logTimer: undefined,
    });

    const repositoryOf = (project: string) =>
      Effect.gen(function* () {
        const slug = projectSlug(project);
        const repository = slug === "" ? undefined : yield* database.peek(slug, readRepositoryProject);
        if (repository === undefined) return yield* unframedError("bad_request", NOT_A_REPOSITORY_PROJECT);
        const { db } = yield* database.open(slug);
        if (!loaded.has(slug)) {
          for (const stored of readInstances(db)) {
            const key = keyOf(slug, stored.id);
            if (!lives.has(key)) lives.set(key, fresh(slug, stored, stored.removedAt === null ? "stopped" : "removed"));
          }
          loaded.add(slug);
        }
        return { slug, repository, db } satisfies RepositoryContext;
      });

    const find = (project: string, id: string) =>
      Effect.gen(function* () {
        const context = yield* repositoryOf(project);
        const live = lives.get(keyOf(context.slug, id));
        if (live === undefined) return yield* unframedError("not_found", INSTANCE_NOT_FOUND);
        return { context, live };
      });

    const writeDb = (slug: string, write: (db: DatabaseSync) => void) =>
      Effect.flatMap(database.open(slug), ({ db }) =>
        Effect.try({ try: () => write(db), catch: (error) => unframedError("internal", `Could not save the Instance: ${errorText(error)}`) }),
      );

    const setupOf = (repository: StoredRepository, worktree: string) =>
      Effect.promise(async (): Promise<RepositorySetup | null> => {
        if (repository.setup !== null) return repository.setup;
        const packageJson = await readFile(join(worktree, "package.json"), "utf8").catch(() => undefined);
        const files = await readdir(worktree).catch(() => []);
        return inferredSetup({ packageJson, files });
      });

    const spawnFor = (live: Live, command: string, extraEnv: Record<string, string>, onOutput?: (chunk: string) => void) =>
      Effect.map(loginShell.setup, ({ env }) => {
        const tracked = spawnTracked({
          command,
          cwd: live.stored.worktree,
          env: { ...env, ...extraEnv },
          pidFile: join(pidDir, `${live.project}--${live.stored.id}.json`),
          onOutput: (chunk) => {
            appendLog(live, chunk);
            onOutput?.(chunk);
          },
        });
        live.process = tracked;
        return tracked;
      });

    const runSetup = (live: Live, command: string) =>
      Effect.gen(function* () {
        setState(live, "installing", { error: null });
        appendLog(live, `$ ${command}\n`);
        const tracked = yield* spawnFor(live, command, {});
        const code = yield* Effect.promise(() => tracked.exited);
        if (live.process === tracked) live.process = undefined;
        if (live.state === "removed") return false;
        if (live.stopping) {
          setState(live, "stopped");
          return false;
        }
        if (code !== 0) {
          setState(live, "failed", { error: setupFailed(code) });
          return false;
        }
        yield* Effect.ignore(writeDb(live.project, (db) => markInstalled(db, live.stored.id)));
        live.stored = { ...live.stored, installed: true };
        setState(live, "stopped");
        return true;
      });

    const reservedPorts = () => new Set([...lives.values()].flatMap((live) => (live.reservedPort === null ? [] : [live.reservedPort])));

    type Verdict =
      | { readonly kind: "live"; readonly port: number }
      | { readonly kind: "failed"; readonly error: string }
      | { readonly kind: "stopped" };

    const awaitListening = async (live: Live, tracked: Tracked, port: number, output: () => string, keepMoved: boolean): Promise<Verdict> => {
      const deadline = Date.now() + START_TIMEOUT_MS;
      for (;;) {
        if (live.stopping || live.state === "removed") return { kind: "stopped" };
        if (tracked.hasExited()) return { kind: "failed", error: exitedBeforeListening(await tracked.exited, port) };
        if (await answers(port)) return { kind: "live", port };
        const other = listenedPorts(output()).find((candidate) => candidate !== port);
        if (other !== undefined && (await answers(other))) return keepMoved ? { kind: "live", port: other } : { kind: "failed", error: movedPort(port, other) };
        if (Date.now() > deadline) return { kind: "failed", error: neverListened(port, START_TIMEOUT_MS / 1000) };
        await new Promise((resolve) => setTimeout(resolve, PROBE_EVERY_MS));
      }
    };

    const heldAfterRelease = async (port: number): Promise<boolean> => {
      const deadline = Date.now() + PORT_RELEASE_MS;
      while (await answers(port)) {
        if (Date.now() > deadline) return true;
        await new Promise((resolve) => setTimeout(resolve, PROBE_EVERY_MS));
      }
      return false;
    };

    const watchWorktree = (live: Live): FSWatcher | undefined => {
      try {
        const watcher = watch(live.stored.worktree, { recursive: true }, (_event, file) => {
          if (file === null || countsAsChange(String(file))) live.lastChangeAt = Date.now();
        });
        watcher.on("error", () => watcher.close());
        watcher.unref();
        return watcher;
      } catch {
        return undefined;
      }
    };

    const recordSinglePort = (slug: string, port: number) =>
      Effect.ignore(
        writeDb(slug, (db) => {
          const repository = readRepository(db);
          if (repository?.setup?.portMode.mode !== "single") return;
          writeRepository(db, { ...repository, setup: { ...repository.setup, portMode: { mode: "single", port } } });
        }),
      );

    const startNow = (context: RepositoryContext, live: Live) =>
      Effect.gen(function* () {
        if (live.state === "live" || live.state === "removed") return undefined;
        const setup = yield* setupOf(context.repository, live.stored.worktree);
        if (setup === null || setup.runCommand.trim() === "") return unframedError("bad_request", NO_RUN_COMMAND);
        if (!live.stored.installed && setup.setupCommand.trim() !== "") {
          if (!(yield* runSetup(live, setup.setupCommand))) return undefined;
        }
        const single = setup.portMode.mode === "single";
        const port = setup.portMode.mode === "single" ? setup.portMode.port : yield* Effect.promise(() => freePort(reservedPorts()));
        if (single && (yield* Effect.promise(() => heldAfterRelease(port)))) {
          setState(live, "failed", { upstreamPort: null, error: portInUse(port) });
          return undefined;
        }
        const packageJson = yield* Effect.promise(() => readFile(join(live.stored.worktree, "package.json"), "utf8").catch(() => undefined));
        const shaped = shapeRunCommand({ command: setup.runCommand, port, scripts: packageScripts(packageJson) });
        live.reservedPort = port;
        setState(live, "starting", { upstreamPort: null, error: null });
        appendLog(live, `$ ${shaped.command}\n`);
        let output = "";
        const tracked = yield* spawnFor(live, shaped.command, shaped.env, (chunk) => (output = appendLogTail(output, chunk, LOG_TAIL_CHARS)));
        const verdict = yield* Effect.promise(() => awaitListening(live, tracked, port, () => output, single));
        if (verdict.kind === "live") {
          const upstream = verdict.port;
          if (upstream !== port) {
            appendLog(live, `${singlePortMoved(port, upstream)}\n`);
            live.reservedPort = upstream;
            yield* recordSinglePort(context.slug, upstream);
          }
          const proxied = yield* Effect.result(
            Effect.tryPromise({
              try: () => startInstanceProxy({ upstreamPort: upstream, preferredPort: live.lastProxyPort }),
              catch: (error) => proxyFailed(errorText(error)),
            }),
          );
          if (proxied._tag === "Success") {
            live.proxy = proxied.success;
            live.lastProxyPort = proxied.success.port;
            live.lastChangeAt = Date.now();
            live.watcher = watchWorktree(live);
            setState(live, "live", { upstreamPort: upstream });
            void tracked.exited.then(async (code) => {
              if (live.process !== tracked) return;
              live.process = undefined;
              live.reservedPort = null;
              const expected = live.stopping || live.state === "removed";
              await closeProxy(live);
              if (expected) return;
              setState(live, "failed", { upstreamPort: null, error: serverExited(code) });
            });
            return undefined;
          }
          yield* Effect.promise(() => stopTracked(tracked, STOP_GRACE_MS));
          if (live.process === tracked) live.process = undefined;
          live.reservedPort = null;
          if (!isRemoved(live)) setState(live, "failed", { upstreamPort: null, error: proxied.failure });
          return undefined;
        }
        yield* Effect.promise(() => stopTracked(tracked, STOP_GRACE_MS));
        if (live.process === tracked) live.process = undefined;
        live.reservedPort = null;
        if (verdict.kind === "failed" && !isRemoved(live)) setState(live, "failed", { upstreamPort: null, error: verdict.error });
        return undefined;
      });

    const closeProxy = async (live: Live) => {
      const proxy = live.proxy;
      live.proxy = undefined;
      live.watcher?.close();
      live.watcher = undefined;
      live.rss = 0;
      await proxy?.close();
    };

    const halt = (live: Live) =>
      Effect.promise(async () => {
        live.stopping = true;
        try {
          if (live.process !== undefined) await stopTracked(live.process, STOP_GRACE_MS);
          await live.queue;
          await closeProxy(live);
        } finally {
          live.stopping = false;
          live.process = undefined;
          live.reservedPort = null;
        }
      });

    const copyInto = async (from: string, to: string, files: ReadonlyArray<string>): Promise<void> => {
      for (const file of files) {
        const source = join(from, file);
        const target = join(to, file);
        if (!(await fileExists(source)) || existsSync(target)) continue;
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      }
    };

    const mergeIntoExclude = async (gitCommonDir: string, files: ReadonlyArray<string>) => {
      const exclude = join(gitCommonDir, "info", "exclude");
      const existing = await readFile(exclude, "utf8").catch(() => "");
      const merged = mergeExclude(existing, files.map((file) => `/${file}`));
      if (merged === existing) return;
      await mkdir(dirname(exclude), { recursive: true });
      await writeFile(exclude, merged);
    };

    const prepareWorktree = (context: RepositoryContext, live: Live) =>
      Effect.gen(function* () {
        const { root, gitCommonDir } = context.repository;
        const ignored = gitOutput(yield* git(root, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ":(glob)**/.env*"])) ?? "";
        const envFiles = copiedEnvFiles(ignored.split("\0").filter((path) => path !== ""));
        const setupFiles = context.repository.setup?.files ?? [];
        const folder = yield* projects.folder(context.slug);
        yield* Effect.tryPromise({
          try: async () => {
            await copyInto(root, live.stored.worktree, envFiles);
            if (folder !== undefined) await copyInto(join(folder, SETUP_FILES_FOLDER), live.stored.worktree, setupFiles);
            await mergeIntoExclude(gitCommonDir, [...envFiles, ...setupFiles]);
          },
          catch: (error) => unframedError("internal", `Could not prepare the worktree: ${errorText(error)}`),
        });
      });

    const copyOver = async (from: string, to: string, files: ReadonlyArray<string>) => {
      for (const file of files) {
        await mkdir(dirname(join(to, file)), { recursive: true });
        await copyFile(join(from, file), join(to, file));
      }
    };

    const saveSetup = (project: string, setup: RepositorySetup, from: string) =>
      Effect.gen(function* () {
        const { context, live } = yield* find(project, from);
        if (isRemoved(live)) return yield* unframedError("bad_request", INSTANCE_REMOVED);
        const files: string[] = [];
        for (const file of setup.files) {
          const path = setupFilePath(file);
          if (path === undefined) return yield* unframedError("bad_request", setupFileOutside(file));
          if (gitOutput(yield* git(live.stored.worktree, ["ls-files", "--error-unmatch", "--", path])) !== undefined) return yield* unframedError("bad_request", setupFileTracked(path));
          if (!(yield* Effect.promise(() => fileExists(join(live.stored.worktree, path))))) return yield* unframedError("bad_request", setupFileMissing(path));
          if (!files.includes(path)) files.push(path);
        }
        const folder = yield* projects.folder(context.slug);
        if (folder === undefined) return yield* unframedError("not_found", REPOSITORY_NOT_FOUND);
        const others = [...lives.values()].filter((other) => other.project === context.slug && other !== live && !isRemoved(other));
        yield* Effect.tryPromise({
          try: async () => {
            await copyOver(live.stored.worktree, join(folder, SETUP_FILES_FOLDER), files);
            for (const other of others) await copyOver(join(folder, SETUP_FILES_FOLDER), other.stored.worktree, files);
            await mergeIntoExclude(context.repository.gitCommonDir, files);
          },
          catch: (error) => unframedError("internal", `Could not copy Setup's files: ${errorText(error)}`),
        });
        yield* writeDb(context.slug, (db) => writeRepository(db, { ...(readRepository(db) ?? context.repository), setup: { ...setup, files } }));
        return { copiedInto: others.map((other) => other.stored.id) };
      });

    const create = (project: string, options: CreateOptions) =>
      Effect.gen(function* () {
        const context = yield* repositoryOf(project);
        const { root, baseBranch } = context.repository;
        if (!existsSync(root)) return yield* unframedError("not_found", REPOSITORY_NOT_FOUND);
        const id = randomBytes(4).toString("hex");
        const branch = options.branch?.trim() || defaultInstanceBranch(id);
        if (gitOutput(yield* git(root, ["check-ref-format", "--branch", branch])) === undefined) return yield* unframedError("bad_request", badBranchName(branch));
        if (gitOutput(yield* git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) !== undefined) {
          return yield* unframedError("conflict", branchTaken(branch));
        }
        const baseRef = options.base?.trim() || baseBranch;
        const baseCommit = gitOutput(yield* git(root, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]))?.trim();
        if (!baseCommit) return yield* unframedError("bad_request", unknownBase(baseRef));
        const worktree = worktreePath(config.dataDir, context.slug, branch, id);
        yield* Effect.promise(() => mkdir(dirname(worktree), { recursive: true }));
        const added = yield* git(root, ["worktree", "add", "--quiet", "--no-track", "-b", branch, worktree, baseRef]);
        if (gitOutput(added) === undefined) {
          return yield* unframedError("internal", `Could not create the worktree: ${added.kind === "exited" ? added.output.trim() : added.kind}`);
        }
        const stored: StoredInstance = { id, branch, baseRef, baseCommit, worktree, installed: false, createdAt: new Date().toISOString(), removedAt: null };
        yield* writeDb(context.slug, (db) => insertInstance(db, stored));
        const live = fresh(context.slug, stored, "creating");
        lives.set(keyOf(context.slug, id), live);
        publish(live);
        const prepared = yield* Effect.result(prepareWorktree(context, live));
        if (prepared._tag === "Failure") {
          setState(live, "failed", { error: prepared.failure.message });
          return view(live);
        }
        const setup = yield* setupOf(context.repository, worktree);
        if (setup === null || setup.setupCommand.trim() === "") {
          yield* writeDb(context.slug, (db) => markInstalled(db, id));
          live.stored = { ...live.stored, installed: true };
          setState(live, "stopped");
          return view(live);
        }
        setState(live, "installing");
        void enqueue(live, runSetup(live, setup.setupCommand)).then(kick);
        return view(live);
      });

    const remove = (project: string, id: string, options: RemoveOptions) =>
      Effect.gen(function* () {
        const { context, live } = yield* find(project, id);
        if (live.state === "removed") return view(live);
        const root = context.repository.root;
        const { branch, worktree, baseRef, baseCommit } = live.stored;
        const branchExists = gitOutput(yield* git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) !== undefined;
        if (options.force !== true) {
          if (existsSync(worktree)) {
            const status = gitOutput(yield* git(worktree, ["status", "--porcelain"]));
            if (status === undefined || status.trim() !== "") return yield* unframedError("conflict", uncommittedWork(branch));
          }
          if (branchExists) {
            const upstream = gitOutput(yield* git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `refs/heads/${branch}@{upstream}`]))?.trim();
            const baseResolves = gitOutput(yield* git(root, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`])) !== undefined;
            const not = [baseCommit, ...(baseResolves ? [baseRef] : []), ...(upstream ? [upstream] : [])];
            const ahead = gitStdout(yield* git(root, ["rev-list", "--count", `refs/heads/${branch}`, "--not", ...not]))?.trim();
            if (ahead !== "0") return yield* unframedError("conflict", unsavedWork(branch));
          }
        }
        yield* halt(live);
        yield* git(root, ["worktree", "remove", "--force", "--force", worktree]);
        yield* Effect.promise(() => rm(worktree, { recursive: true, force: true }));
        yield* git(root, ["worktree", "prune"]);
        if (options.deleteBranch === true && branchExists) yield* git(root, ["branch", "-D", branch]);
        const removedAt = new Date().toISOString();
        yield* writeDb(context.slug, (db) => markRemoved(db, id, removedAt));
        live.stored = { ...live.stored, removedAt };
        setState(live, "removed", { upstreamPort: null });
        return view(live);
      });

    const list = (project: string) =>
      Effect.map(repositoryOf(project), ({ slug }) => [...lives.values()].filter((live) => live.project === slug).map(view));

    const status = (project: string, id: string) => Effect.map(find(project, id), ({ live }) => view(live));

    const stopNow = async (live: Live, note?: string) => {
      if (live.state === "removed") return;
      await Effect.runPromise(halt(live));
      if (note !== undefined) appendLog(live, `${note}\n`);
      if (!isRemoved(live)) setState(live, "stopped", { upstreamPort: null });
    };

    const repositoryLocks = new Map<string, Promise<unknown>>();

    const singlePort = (context: RepositoryContext) => context.repository.setup?.portMode.mode === "single";

    const startInstance = (context: RepositoryContext, live: Live): Promise<UnframedError | undefined> => {
      if (!singlePort(context)) return enqueue(live, startNow(context, live));
      const run = (repositoryLocks.get(context.slug) ?? Promise.resolve()).then(async () => {
        for (const other of lives.values()) {
          if (other !== live && other.project === context.slug && (other.state === "live" || other.state === "starting")) await stopNow(other);
        }
        return enqueue(live, startNow(context, live));
      });
      repositoryLocks.set(
        context.slug,
        run.catch(() => undefined),
      );
      return run;
    };

    const start = (project: string, id: string) =>
      Effect.gen(function* () {
        const { context, live } = yield* find(project, id);
        if (live.state === "removed") return yield* unframedError("conflict", INSTANCE_REMOVED);
        const refused = yield* Effect.promise(() => startInstance(context, live));
        if (refused !== undefined) return yield* refused;
        return view(live);
      });

    const stop = (project: string, id: string) =>
      Effect.gen(function* () {
        const { live } = yield* find(project, id);
        yield* Effect.promise(() => stopNow(live));
        return view(live);
      });

    const idleMs = config.testInstanceIdleMs ?? INSTANCE_IDLE_MS;
    const sampleMs = config.testInstanceSampleMs ?? SAMPLE_EVERY_MS;
    const budget = config.testInstanceBudgetBytes ?? instanceMemoryBudget(totalmem());
    const demands = new Map<string, Map<string, ReadonlySet<string>>>();
    let demandCounter = 0;
    let scheduled: Promise<void> = Promise.resolve();

    const demandedIn = (slug: string): Set<string> => new Set([...(demands.get(slug)?.values() ?? [])].flatMap((ids) => [...ids]));

    const isDemanded = (live: Live) => demandedIn(live.project).has(live.stored.id);

    const schedule = (run: () => Promise<void>): Promise<void> => {
      scheduled = scheduled.then(run).catch(() => undefined);
      return scheduled;
    };

    const processTable = (): Promise<string> =>
      new Promise((resolve) => {
        if (process.platform === "win32") return resolve("");
        execFile("ps", ["-A", "-o", "pid=,ppid=,pgid=,rss="], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error === null ? stdout : ""));
      });

    const running = () => [...lives.values()].filter((live) => live.state === "live" && live.process?.child.pid !== undefined);

    const measure = async () => {
      const live = running();
      if (live.length === 0) return;
      const rows = parseProcessTable(await processTable());
      for (const instance of live) instance.rss = processTreeRss(rows, instance.process!.child.pid!);
    };

    const enforceBudget = async () => {
      await measure();
      const live = running();
      const byKey = new Map(live.map((instance) => [keyOf(instance.project, instance.stored.id), instance]));
      const evicted = evictionsOverBudget(
        live.map((instance) => ({ id: keyOf(instance.project, instance.stored.id), rss: instance.rss, lastDemandedAt: instance.demandOrder, demanded: isDemanded(instance) })),
        budget,
      );
      for (const key of evicted) {
        const instance = byKey.get(key)!;
        if (isDemanded(instance)) instance.suppressed = true;
        await stopNow(instance, stoppedForBudget);
      }
    };

    const stopIdle = async () => {
      const now = Date.now();
      for (const instance of running()) {
        if (idleToStop({ demanded: isDemanded(instance), lastDemandedAt: instance.lastDemandedAt, lastChangeAt: instance.lastChangeAt, now, idleMs })) {
          await stopNow(instance, stoppedWhenIdle);
        }
      }
    };

    const reconcile = async () => {
      const pending: Array<{ readonly context: RepositoryContext; readonly live: Live }> = [];
      for (const slug of demands.keys()) {
        const wanted = demandedIn(slug);
        if (wanted.size === 0) continue;
        const found = await Effect.runPromise(Effect.result(repositoryOf(slug)));
        if (found._tag === "Failure") continue;
        const context = found.success;
        const candidates = [...wanted]
          .flatMap((id) => {
            const live = lives.get(keyOf(slug, id));
            return live === undefined || isRemoved(live) || live.suppressed ? [] : [live];
          })
          .sort((a, b) => b.demandOrder - a.demandOrder);
        for (const live of singlePort(context) ? candidates.slice(0, 1) : candidates) {
          if (live.state === "stopped" || (live.state === "failed" && live.retry)) pending.push({ context, live });
        }
      }
      pending.sort((a, b) => b.live.demandOrder - a.live.demandOrder);
      for (const { context, live } of pending) {
        live.retry = false;
        if (!isDemanded(live) || live.suppressed || (live.state !== "stopped" && live.state !== "failed")) continue;
        const refused = await startInstance(context, live).catch(() => undefined);
        if (refused !== undefined && !isRemoved(live)) setState(live, "failed", { error: refused.message });
        await enforceBudget();
      }
    };

    const kick = () => void schedule(reconcile);

    const clientKey = (connection: string | undefined, client: string) => (connection === undefined ? client : `${connection}\n${client}`);

    const setDemand = (slug: string, key: string, ids: ReadonlyArray<string>) => {
      const before = demandedIn(slug);
      const clients = demands.get(slug) ?? new Map<string, ReadonlySet<string>>();
      const wanted = [...new Set(ids)].filter((id) => lives.has(keyOf(slug, id)));
      if (wanted.length === 0) clients.delete(key);
      else clients.set(key, new Set(wanted));
      if (clients.size === 0) demands.delete(slug);
      else demands.set(slug, clients);
      return { before, wanted };
    };

    const settleDemand = (slug: string, before: ReadonlySet<string>, wanted: ReadonlyArray<string>) => {
      const after = demandedIn(slug);
      const now = Date.now();
      for (const id of before) {
        if (after.has(id)) continue;
        const live = lives.get(keyOf(slug, id))!;
        live.demandOrder = ++demandCounter;
        live.lastDemandedAt = now;
      }
      for (const id of [...wanted].reverse()) {
        if (before.has(id)) continue;
        const live = lives.get(keyOf(slug, id))!;
        live.demandOrder = ++demandCounter;
        live.suppressed = false;
        live.retry = true;
      }
      for (const id of after) lives.get(keyOf(slug, id))!.lastDemandedAt = now;
      kick();
      return after;
    };

    const demand = (project: string, client: string, ids: ReadonlyArray<string>, connection?: string) =>
      Effect.gen(function* () {
        const { slug } = yield* repositoryOf(project);
        const { before, wanted } = setDemand(slug, clientKey(connection, client), ids);
        const after = settleDemand(slug, before, wanted);
        return [...after].map((id) => view(lives.get(keyOf(slug, id))!));
      });

    const release = (connection: string) =>
      Effect.sync(() => {
        for (const [slug, clients] of [...demands]) {
          const keys = [...clients.keys()].filter((key) => key.startsWith(`${connection}\n`));
          if (keys.length === 0) continue;
          const before = demandedIn(slug);
          for (const key of keys) clients.delete(key);
          if (clients.size === 0) demands.delete(slug);
          settleDemand(slug, before, []);
        }
      });

    const ticker = setInterval(() => {
      void schedule(async () => {
        await enforceBudget();
        await stopIdle();
      });
    }, sampleMs);
    ticker.unref();

    const changes = (project: string) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(events);
          const current = yield* list(project);
          const slug = projectSlug(project);
          return Stream.concat(
            Stream.fromIterable(current),
            Stream.fromSubscription(subscription).pipe(Stream.filter((instance) => instance.repository === slug)),
          );
        }),
      );

    yield* shutdown.register(
      "dev servers",
      Effect.promise(() => {
        clearInterval(ticker);
        return Promise.all(
          [...lives.values()].map(async (live) => {
            live.stopping = true;
            if (live.process !== undefined) await stopTracked(live.process, SHUTDOWN_GRACE_MS);
            await closeProxy(live);
          }),
        );
      }),
    );

    const branches = (project: string) =>
      Effect.gen(function* () {
        const { repository } = yield* repositoryOf(project);
        if (!existsSync(repository.root)) return yield* unframedError("not_found", REPOSITORY_NOT_FOUND);
        const listed = gitOutput(yield* git(repository.root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"])) ?? "";
        const current = gitOutput(yield* git(repository.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]))?.trim() || repository.baseBranch;
        return { branches: listed.split("\n").map((line) => line.trim()).filter((line) => line !== ""), current };
      });

    const everyChange = Stream.unwrap(Effect.map(PubSub.subscribe(events), (subscription) => Stream.fromSubscription(subscription)));

    return Instances.of({ create, remove, list, status, start, stop, demand, release, branches, saveSetup, everyChange, changes });
  }),
);
