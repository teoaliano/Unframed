/**
 * The environment a provider CLI runs in (spec 07). Probes and sessions build it the same
 * way, so a probe never calls a CLI ready that a session then cannot spawn.
 */

/** The last non-empty line of the login shell's `echo "$PATH"`. */
export const shellPathFromOutput = (output: string): string | undefined =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);

/** The process's own PATH entries first, then the login shell's, without duplicates or empty entries. */
export const mergePath = (processPath: string | undefined, shellPath: string | undefined, delimiter = ":"): string => {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of [...(processPath ?? "").split(delimiter), ...(shellPath ?? "").split(delimiter)]) {
    if (entry === "" || seen.has(entry)) continue;
    seen.add(entry);
    merged.push(entry);
  }
  return merged.join(delimiter);
};

export interface RunEnvironmentInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** PATH after hydration from the login shell. */
  readonly path: string;
  /** The `CLAUDE_CONFIG_DIR` setting; empty means unset. */
  readonly claudeConfigDir: string;
  /** The OS's home folder, used only when HOME is missing. */
  readonly osHome: string;
}

/**
 * The environment for a provider process. HOME is never overridden: a present one is kept
 * and a missing one is filled from the OS, because moving HOME moves the macOS keychain
 * lookup and the CLI then reports a signed-in person as signed out. A second Claude
 * account is expressed only as `CLAUDE_CONFIG_DIR`, set when the setting is not empty.
 */
export const runEnvironment = (input: RunEnvironmentInput): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.env)) if (value !== undefined) env[name] = value;
  env.PATH = input.path;
  if (env.HOME === undefined || env.HOME === "") env.HOME = input.osHome;
  const configDir = input.claudeConfigDir.trim();
  if (configDir !== "") env.CLAUDE_CONFIG_DIR = configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  return env;
};

export interface WindowsLookup {
  /** PATH's folders, in order. */
  readonly pathDirs: ReadonlyArray<string>;
  /** PATHEXT, for example `.COM;.EXE;.BAT;.CMD`. */
  readonly pathext: string;
  readonly exists: (path: string) => boolean;
  /** Joins path segments with Windows separators. */
  readonly join?: (...parts: string[]) => string;
}

const winJoin = (...parts: string[]): string =>
  parts
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join("\\");

const winDirname = (path: string): string => {
  const at = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return at < 0 ? "." : path.slice(0, at);
};

const LAUNCHERS = new Set([".cmd", ".bat", ".ps1"]);

/** The package entries beside an npm launcher for `claude`, relative to the launcher folder, in the order tried. */
export const CLAUDE_PACKAGE_ENTRIES: ReadonlyArray<ReadonlyArray<string>> = [
  ["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"],
  ["node_modules", "@anthropic-ai", "claude-code", "cli.js"],
];

/**
 * What to spawn for a bare command name on Windows. The name is looked up on PATH with
 * PATHEXT; an npm launcher (`.cmd`, `.bat`, `.ps1`) is replaced by the first package entry
 * beside it that exists (for Claude `bin/claude.exe`, else `cli.js`), because a launcher
 * shim cannot be spawned directly. With nothing found the bare name comes back, so
 * spawning it fails as ENOENT. A path is returned as is.
 */
export const resolveWindowsCommand = (
  command: string,
  lookup: WindowsLookup,
  packageEntries: ReadonlyArray<ReadonlyArray<string>> = CLAUDE_PACKAGE_ENTRIES,
): string => {
  if (/[\\/]/.test(command)) return command;
  const join = lookup.join ?? winJoin;
  const extensions = lookup.pathext
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext !== "");
  const hasExtension = /\.[^.\\/]+$/.test(command);
  const candidates = hasExtension ? [command, ...extensions.map((ext) => command + ext)] : extensions.map((ext) => command + ext);
  for (const dir of lookup.pathDirs) {
    if (dir === "") continue;
    for (const name of candidates) {
      const found = join(dir, name);
      if (!lookup.exists(found)) continue;
      const ext = /\.[^.\\/]+$/.exec(found)?.[0]?.toLowerCase() ?? "";
      if (!LAUNCHERS.has(ext)) return found;
      for (const entry of packageEntries) {
        const path = join(winDirname(found), ...entry);
        if (lookup.exists(path)) return path;
      }
      return command;
    }
  }
  return command;
};
