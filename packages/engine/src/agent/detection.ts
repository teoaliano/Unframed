import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { ProviderStatus, ProviderStatuses } from "@unframed/contracts";
import {
  CLAUDE_CATALOGUE,
  CODEX_FIXED_COMMANDS,
  PROVIDER_INSTALL_PAGES,
  PROVIDER_NAMES,
  claudeCommands,
  claudeModelRows,
  claudeProbeAuth,
  claudeSkills,
  classifyProvider,
  codexSkills,
  mergePath,
  mergeSkillOverrides,
  parseCodexLoginStatus,
  resolveWindowsCommand,
  runEnvironment as buildEnvironment,
  shellPathFromOutput,
  type AgentProvider,
  type AuthProbe,
  type ModelRow,
  type OfferedCommand,
  type SkillFile,
  type VersionRun,
} from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { errorText, logInfo } from "../log.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import { CodexRpc, initializeCodex } from "./codexRpc.ts";
import { ENGINE_VERSION } from "./version.ts";

export const STATUS_CACHE_MS = 5 * 60_000;
const VERSION_TIMEOUT_MS = 5_000;
const SHELL_TIMEOUT_MS = 4_000;
const CLAUDE_PROBE_TIMEOUT_MS = 15_000;
const CODEX_LOGIN_TIMEOUT_MS = 8_000;
const CODEX_LIST_TIMEOUT_MS = 10_000;

/** What a session of a provider spawns and with which environment. */
export interface RunEnvironment {
  readonly executable: string;
  readonly env: Record<string, string>;
}

export const SCRIPTED_AUTH = { email: "scripted@unframed.test", plan: "Script" } as const;
export const SCRIPTED_MODEL: ModelRow = { id: "scripted", name: "Scripted", description: "", efforts: [], legacy: false };

/**
 * Provider detection: `status` answers one of five statuses per provider, cached for five
 * minutes; `runEnvironment` answers the executable and environment a session must use.
 * The executable path comes only from settings and is never part of a status.
 */
export class ProviderDetection extends Context.Service<
  ProviderDetection,
  {
    readonly statuses: (options: { readonly refresh?: boolean; readonly projectFolder?: string }) => Effect.Effect<ProviderStatuses>;
    readonly runEnvironment: (provider: AgentProvider) => Effect.Effect<RunEnvironment>;
    /** Forgets a provider's cached status, after one of its settings was saved. */
    readonly forget: (provider: AgentProvider) => Effect.Effect<void>;
  }
>()("unframed/engine/ProviderDetection") {}

type Spawned = VersionRun & { readonly stderr?: string };

/** Runs a command to completion, capturing stdout and stderr together, killed after `timeoutMs`. */
export const runCommand = (executable: string, args: ReadonlyArray<string>, env: Record<string, string>, timeoutMs: number): Promise<Spawned> =>
  new Promise((resolve) => {
    const [command, commandArgs] = executable.endsWith(".js") ? [process.execPath, [executable, ...args]] : [executable, [...args]];
    let settled = false;
    let output = "";
    const finish = (result: Spawned) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, commandArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      finish(code === "ENOENT" ? { kind: "not_found" } : { kind: "spawn_failed", code: code ?? errorText(error) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ kind: "timed_out" });
    }, timeoutMs);
    timer.unref();
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ENOENT" ? { kind: "not_found" } : { kind: "spawn_failed", code: error.code ?? error.message });
    });
    child.on("close", (code) => finish({ kind: "exited", code, output }));
  });

/** The package entry beside an npm `codex` launcher on Windows. */
const CODEX_PACKAGE_ENTRIES = [["node_modules", "@openai", "codex", "bin", "codex.js"]];

const isExecutable =(path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** A bare name found on PATH, else the name itself so spawning it fails as ENOENT. */
const resolveOnPath = (command: string, path: string, platform: NodeJS.Platform, env: Record<string, string>): string => {
  if (platform === "win32") {
    return resolveWindowsCommand(command, {
      pathDirs: path.split(";"),
      pathext: env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
      exists: existsSync,
    }, command.toLowerCase().includes("codex") ? CODEX_PACKAGE_ENTRIES : undefined);
  }
  if (command.includes("/")) return command;
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return command;
};

/** A prompt that never yields: the probe's query speaks only control requests. */
async function* silentPrompt(signal: AbortSignal): AsyncGenerator<never, void> {
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

interface ClaudeProbe {
  readonly auth: AuthProbe;
  readonly models: ReadonlyArray<ModelRow>;
  readonly commands: ReadonlyArray<OfferedCommand>;
}

/**
 * The zero-token Claude probe: a query whose prompt never yields, with no setting sources,
 * no tools and session persistence off, read for its initialization (the account, the
 * commands) and its supported models, then aborted.
 */
const probeClaude = async (run: RunEnvironment): Promise<ClaudeProbe> => {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), CLAUDE_PROBE_TIMEOUT_MS);
  timeout.unref();
  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const q = query({
      prompt: silentPrompt(abortController.signal),
      options: {
        pathToClaudeCodeExecutable: run.executable,
        env: run.env,
        settingSources: [],
        tools: [],
        permissionMode: "default",
        persistSession: false,
        abortController,
      },
    });
    try {
      const aborted = new Promise<never>((_, reject) =>
        abortController.signal.addEventListener("abort", () => reject(new Error("the Claude probe timed out")), { once: true }),
      );
      const init = await Promise.race([q.initializationResult(), aborted]);
      const models = await Promise.race([q.supportedModels(), aborted]).catch(() => init.models ?? []);
      return {
        auth: claudeProbeAuth(init.account),
        models: claudeModelRows(models, CLAUDE_CATALOGUE),
        commands: claudeCommands(init.commands ?? []),
      };
    } finally {
      abortController.abort();
      try {
        q.close();
      } catch {
        // already closed
      }
    }
  } catch (error) {
    logInfo(`claude probe: ${errorText(error)}`);
    return { auth: { kind: "unknown" }, models: [], commands: claudeCommands([]) };
  } finally {
    clearTimeout(timeout);
    abortController.abort();
  }
};

const readSkillFolder = async (root: string): Promise<SkillFile[]> => {
  const names = await readdir(root).catch(() => [] as string[]);
  const files: SkillFile[] = [];
  for (const folder of names.sort()) {
    const text = await readFile(join(root, folder, "SKILL.md"), "utf8").catch(() => undefined);
    if (text !== undefined) files.push({ folder, text });
  }
  return files;
};

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

/** Claude's skills from the config folder and the project's `.claude/skills`. */
const scanClaudeSkills = async (env: Record<string, string>, projectFolder: string | undefined): Promise<OfferedCommand[]> => {
  const configDir = env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), ".claude");
  const settings = [await readJson(join(configDir, "settings.json"))];
  if (projectFolder !== undefined) {
    settings.push(await readJson(join(projectFolder, ".claude", "settings.json")));
    settings.push(await readJson(join(projectFolder, ".claude", "settings.local.json")));
  }
  return claudeSkills({
    config: await readSkillFolder(join(configDir, "skills")),
    project: projectFolder === undefined ? [] : await readSkillFolder(join(projectFolder, ".claude", "skills")),
    overrides: mergeSkillOverrides(settings),
  });
};

interface CodexListing {
  readonly models: ReadonlyArray<ModelRow>;
  readonly skills: ReadonlyArray<OfferedCommand>;
}

type CodexModel = {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: ReadonlyArray<{ reasoningEffort?: string } | string>;
};

/** Codex's model rows from the app-server's paged `model/list`, the default first. */
export const codexModelRows = (models: ReadonlyArray<CodexModel>): ModelRow[] => {
  const rows = models
    .filter((model) => model.hidden !== true && typeof (model.model ?? model.id) === "string")
    .map((model) => ({
      row: {
        id: (model.model ?? model.id)!,
        name: model.displayName ?? (model.model ?? model.id)!,
        description: model.description ?? "",
        efforts: (model.supportedReasoningEfforts ?? [])
          .map((effort) => (typeof effort === "string" ? effort : effort.reasoningEffort))
          .filter((effort): effort is string => typeof effort === "string"),
        legacy: false,
        ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}),
      } satisfies ModelRow,
      isDefault: model.isDefault === true,
    }));
  return [...rows.filter((entry) => entry.isDefault), ...rows.filter((entry) => !entry.isDefault)].map((entry) => entry.row);
};

const listCodex = async (run: RunEnvironment, projectFolder: string | undefined): Promise<CodexListing> => {
  const rpc = new CodexRpc({ executable: run.executable, args: ["app-server"], env: run.env });
  try {
    await initializeCodex(rpc, ENGINE_VERSION);
    const models: CodexModel[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 20; page++) {
      const answer = await rpc.request<{ data?: CodexModel[]; nextCursor?: string | null }>(
        "model/list",
        cursor ? { cursor } : {},
        CODEX_LIST_TIMEOUT_MS,
      );
      models.push(...(answer?.data ?? []));
      cursor = answer?.nextCursor;
      if (!cursor) break;
    }
    const skills = await rpc
      .request("skills/list", { cwds: projectFolder === undefined ? [] : [projectFolder] }, CODEX_LIST_TIMEOUT_MS)
      .then(codexSkills, () => []);
    return { models: codexModelRows(models), skills };
  } catch (error) {
    logInfo(`codex model list: ${errorText(error)}`);
    return { models: [], skills: [] };
  } finally {
    rpc.close();
  }
};

export const providerDetectionLayer = Layer.effect(
  ProviderDetection,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    let hydrated: Promise<string> | undefined;

    /** PATH with the login shell's entries appended, once per process. */
    const hydratedPath = (): Promise<string> => {
      hydrated ??= (async () => {
        const own = process.env.PATH;
        if (config.platform === "win32") return own ?? "";
        const shell = process.env.SHELL?.trim() || "/bin/sh";
        const answer = await runCommand(shell, ["-lc", 'echo "$PATH"'], { ...(process.env as Record<string, string>) }, SHELL_TIMEOUT_MS);
        const shellPath = answer.kind === "exited" && answer.code === 0 ? shellPathFromOutput(answer.output) : undefined;
        return mergePath(own, shellPath, delimiter);
      })();
      return hydrated;
    };

    const environmentFor = async (provider: AgentProvider): Promise<RunEnvironment> => {
      const current = Effect.runSync(settings.read);
      const path = await hydratedPath();
      const env = buildEnvironment({ env: process.env, path, claudeConfigDir: current.claudeConfigDir, osHome: homedir() });
      const configured = (provider === "claude" ? current.claudePath : current.codexPath).trim();
      const executable = resolveOnPath(configured === "" ? provider : configured, path, config.platform, env);
      return { executable, env };
    };

    const cache = new Map<string, { at: number; status: Promise<ProviderStatus> }>();
    const generation: Record<AgentProvider, number> = { claude: 0, codex: 0 };

    const base = (provider: AgentProvider) => ({ kind: provider, name: PROVIDER_NAMES[provider], install: PROVIDER_INSTALL_PAGES[provider] });

    const scriptedStatus = (provider: AgentProvider): ProviderStatus => ({
      ...base(provider),
      status: "ready",
      installed: true,
      version: null,
      auth: { ...SCRIPTED_AUTH },
      models: [SCRIPTED_MODEL],
      commands: provider === "claude" ? claudeCommands([]) : [...CODEX_FIXED_COMMANDS],
      skills: [],
      checkedAt: new Date().toISOString(),
    });

    const check = async (provider: AgentProvider, projectFolder: string | undefined): Promise<ProviderStatus> => {
      const run = await environmentFor(provider);
      const version = await runCommand(run.executable, ["--version"], run.env, VERSION_TIMEOUT_MS);
      const ran = version.kind === "exited" && version.code === 0;
      let probe: AuthProbe | undefined;
      let models: ReadonlyArray<ModelRow> = [];
      let commands: ReadonlyArray<OfferedCommand> = [];
      let skills: ReadonlyArray<OfferedCommand> = [];
      if (ran && provider === "claude") {
        const claude = await probeClaude(run);
        probe = claude.auth;
        models = claude.models;
        commands = claude.commands;
        skills = await scanClaudeSkills(run.env, projectFolder);
      } else if (ran) {
        const login = await runCommand(run.executable, ["login", "status"], run.env, CODEX_LOGIN_TIMEOUT_MS);
        probe = login.kind === "exited" ? parseCodexLoginStatus(login.output) : { kind: "unknown" };
        commands = CODEX_FIXED_COMMANDS;
        if (probe.kind === "signed_in") {
          const listing = await listCodex(run, projectFolder);
          models = listing.models;
          skills = listing.skills;
        }
      }
      const classified = classifyProvider(provider, version, probe);
      return {
        ...base(provider),
        status: classified.status,
        installed: classified.installed,
        version: classified.version,
        ...(classified.message === undefined ? {} : { message: classified.message }),
        ...(classified.auth === undefined ? {} : { auth: classified.auth }),
        ...(classified.status === "ready" ? { models: [...models], commands: [...commands], skills: [...skills] } : {}),
        checkedAt: new Date().toISOString(),
      };
    };

    const status = (provider: AgentProvider, refresh: boolean, projectFolder: string | undefined): Promise<ProviderStatus> => {
      if (config.testAgentScript !== undefined) return Promise.resolve(scriptedStatus(provider));
      const key = `${provider}\u0000${projectFolder ?? ""}`;
      const cached = cache.get(key);
      if (!refresh && cached && Date.now() - cached.at < STATUS_CACHE_MS) return cached.status;
      const made = generation[provider];
      const pending = check(provider, projectFolder);
      const entry = { at: Date.now(), status: pending };
      cache.set(key, entry);
      pending.catch(() => {
        if (cache.get(key) === entry) cache.delete(key);
      });
      return pending.then((value) => {
        if (generation[provider] !== made && cache.get(key) === entry) cache.delete(key);
        return value;
      });
    };

    return ProviderDetection.of({
      statuses: ({ refresh, projectFolder }) =>
        Effect.promise(async () => {
          const [claude, codex] = await Promise.all([
            status("claude", refresh === true, projectFolder),
            status("codex", refresh === true, projectFolder),
          ]);
          return { claude, codex };
        }),
      runEnvironment: (provider) => Effect.promise(() => environmentFor(provider)),
      forget: (provider) =>
        Effect.sync(() => {
          generation[provider]++;
          for (const key of [...cache.keys()]) if (key.startsWith(`${provider}\u0000`)) cache.delete(key);
        }),
    });
  }),
);
