import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { UnframedError, unframedError, type Instance, type InstanceState, type RepositorySetup } from "@unframed/contracts";
import {
  INSTANCE_NOT_FOUND,
  INSTANCE_REMOVED,
  NO_RUN_COMMAND,
  NOT_A_REPOSITORY_PROJECT,
  REPOSITORY_NOT_FOUND,
  appendLogTail,
  badBranchName,
  branchTaken,
  copiedEnvFiles,
  defaultInstanceBranch,
  exitedBeforeListening,
  inferredSetup,
  listenedPorts,
  mergeExclude,
  movedPort,
  neverListened,
  packageScripts,
  projectSlug,
  serverExited,
  setupFailed,
  shapeRunCommand,
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
import { makeGit, gitOutput } from "../repositories/git.ts";
import { readKind, readRepository, type StoredRepository } from "../repositories/tables.ts";
import { Config } from "../services.ts";
import { Shutdown } from "../shutdown.ts";
import { answers, freePort, spawnTracked, stopTracked, sweepLeftovers, type Tracked } from "./processes.ts";
import { insertInstance, markInstalled, markRemoved, readInstances, type StoredInstance } from "./tables.ts";

const LOG_TAIL_CHARS = 16_000;
const LOG_PUBLISH_MS = 500;
const START_TIMEOUT_MS = 120_000;
const PROBE_EVERY_MS = 150;
const STOP_GRACE_MS = 3_000;
const SHUTDOWN_GRACE_MS = 1_500;
const SETUP_FILES_FOLDER = "setup-files";

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
      proxyPort: null,
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
      stopping: false,
      queue: Promise.resolve(),
      logTimer: undefined,
    });

    const repositoryOf = (project: string) =>
      Effect.gen(function* () {
        const slug = projectSlug(project);
        const repository =
          slug === "" ? undefined : yield* database.peek(slug, (db) => (readKind(db) === "repository" ? readRepository(db) : undefined));
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

    type Verdict = { readonly kind: "live" } | { readonly kind: "failed"; readonly error: string } | { readonly kind: "stopped" };

    const awaitListening = async (live: Live, tracked: Tracked, port: number, output: () => string): Promise<Verdict> => {
      const deadline = Date.now() + START_TIMEOUT_MS;
      for (;;) {
        if (live.stopping || live.state === "removed") return { kind: "stopped" };
        if (tracked.hasExited()) return { kind: "failed", error: exitedBeforeListening(await tracked.exited, port) };
        if (await answers(port)) return { kind: "live" };
        const other = listenedPorts(output()).find((candidate) => candidate !== port);
        if (other !== undefined && (await answers(other))) return { kind: "failed", error: movedPort(port, other) };
        if (Date.now() > deadline) return { kind: "failed", error: neverListened(port, START_TIMEOUT_MS / 1000) };
        await new Promise((resolve) => setTimeout(resolve, PROBE_EVERY_MS));
      }
    };

    const startNow = (context: RepositoryContext, live: Live) =>
      Effect.gen(function* () {
        if (live.state === "live" || live.state === "removed") return undefined;
        const setup = yield* setupOf(context.repository, live.stored.worktree);
        if (setup === null || setup.runCommand.trim() === "") return unframedError("bad_request", NO_RUN_COMMAND);
        if (!live.stored.installed && setup.setupCommand.trim() !== "") {
          if (!(yield* runSetup(live, setup.setupCommand))) return undefined;
        }
        const port = setup.portMode.mode === "single" ? setup.portMode.port : yield* Effect.promise(() => freePort(reservedPorts()));
        const packageJson = yield* Effect.promise(() => readFile(join(live.stored.worktree, "package.json"), "utf8").catch(() => undefined));
        const shaped = shapeRunCommand({ command: setup.runCommand, port, scripts: packageScripts(packageJson) });
        live.reservedPort = port;
        setState(live, "starting", { upstreamPort: null, error: null });
        appendLog(live, `$ ${shaped.command}\n`);
        let output = "";
        const tracked = yield* spawnFor(live, shaped.command, shaped.env, (chunk) => (output = appendLogTail(output, chunk, LOG_TAIL_CHARS)));
        const verdict = yield* Effect.promise(() => awaitListening(live, tracked, port, () => output));
        if (verdict.kind === "live") {
          setState(live, "live", { upstreamPort: port });
          void tracked.exited.then((code) => {
            if (live.process !== tracked) return;
            live.process = undefined;
            live.reservedPort = null;
            if (live.stopping || live.state === "removed") return;
            setState(live, "failed", { upstreamPort: null, error: serverExited(code) });
          });
          return undefined;
        }
        yield* Effect.promise(() => stopTracked(tracked, STOP_GRACE_MS));
        if (live.process === tracked) live.process = undefined;
        live.reservedPort = null;
        if (verdict.kind === "failed" && !isRemoved(live)) setState(live, "failed", { upstreamPort: null, error: verdict.error });
        return undefined;
      });

    const halt = (live: Live) =>
      Effect.promise(async () => {
        live.stopping = true;
        try {
          if (live.process !== undefined) await stopTracked(live.process, STOP_GRACE_MS);
          await live.queue;
        } finally {
          live.stopping = false;
          live.process = undefined;
          live.reservedPort = null;
        }
      });

    const copyInto = async (from: string, to: string, files: ReadonlyArray<string>): Promise<string[]> => {
      const copied: string[] = [];
      for (const file of files) {
        const source = join(from, file);
        const target = join(to, file);
        if (!(await fileExists(source)) || existsSync(target)) continue;
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
        copied.push(file);
      }
      return copied;
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
            const copied = await copyInto(root, live.stored.worktree, envFiles);
            if (folder !== undefined) copied.push(...(await copyInto(join(folder, SETUP_FILES_FOLDER), live.stored.worktree, setupFiles)));
            const entries = [...envFiles, ...setupFiles].map((file) => `/${file}`);
            const exclude = join(gitCommonDir, "info", "exclude");
            const existing = await readFile(exclude, "utf8").catch(() => "");
            const merged = mergeExclude(existing, entries);
            if (merged !== existing) {
              await mkdir(dirname(exclude), { recursive: true });
              await writeFile(exclude, merged);
            }
          },
          catch: (error) => unframedError("internal", `Could not prepare the worktree: ${errorText(error)}`),
        });
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
        void enqueue(live, runSetup(live, setup.setupCommand));
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
            const ahead = gitOutput(yield* git(root, ["rev-list", "--count", `refs/heads/${branch}`, "--not", ...not]));
            if (ahead === undefined || Number(ahead.trim()) > 0) return yield* unframedError("conflict", unsavedWork(branch));
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

    const start = (project: string, id: string) =>
      Effect.gen(function* () {
        const { context, live } = yield* find(project, id);
        if (live.state === "removed") return yield* unframedError("conflict", INSTANCE_REMOVED);
        const refused = yield* Effect.promise(() => enqueue(live, startNow(context, live)));
        if (refused !== undefined) return yield* refused;
        return view(live);
      });

    const stop = (project: string, id: string) =>
      Effect.gen(function* () {
        const { live } = yield* find(project, id);
        if (live.state === "removed") return view(live);
        yield* halt(live);
        if (!isRemoved(live)) setState(live, "stopped", { upstreamPort: null });
        return view(live);
      });

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
      Effect.promise(() =>
        Promise.all(
          [...lives.values()].map(async (live) => {
            live.stopping = true;
            if (live.process !== undefined) await stopTracked(live.process, SHUTDOWN_GRACE_MS);
          }),
        ),
      ),
    );

    return Instances.of({ create, remove, list, status, start, stop, changes });
  }),
);
