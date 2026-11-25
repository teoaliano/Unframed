import type { PackageManager, RepositorySetup } from "@unframed/contracts";

export const INSTANCE_NOT_FOUND = "That worktree does not exist.";
export const INSTANCE_REMOVED = "That branch's worktree was removed.";
export const NOT_A_REPOSITORY_PROJECT = "That project is not a Repository.";
export const REPOSITORY_NOT_FOUND = "Repository not found.";
export const NO_RUN_COMMAND = "Unframed does not know how to run this repository yet. Setup finds the run command.";
export const branchTaken = (branch: string): string => `A branch named "${branch}" already exists.`;
export const badBranchName = (branch: string): string => `"${branch}" is not a valid branch name.`;
export const unknownBase = (base: string): string => `There is no branch or commit named "${base}".`;
export const unsavedWork = (branch: string): string =>
  `The branch "${branch}" has work that is not pushed or merged. Remove it anyway to lose that work.`;
export const uncommittedWork = (branch: string): string =>
  `The worktree of "${branch}" has uncommitted changes. Remove it anyway to lose them.`;
export const exitedBeforeListening = (code: number | null, port: number): string =>
  `The dev server exited${code === null ? "" : ` with code ${code}`} before it listened on port ${port}.`;
export const movedPort = (expected: number, actual: number): string =>
  `The dev server listened on port ${actual} instead of ${expected}, so its port cannot be chosen.`;
export const serverExited = (code: number | null): string => `The dev server exited${code === null ? "" : ` with code ${code}`}.`;
export const neverListened = (port: number, seconds: number): string => `The dev server did not listen on port ${port} within ${seconds} seconds.`;
export const portInUse = (port: number): string =>
  `Something else is already listening on port ${port}, the fixed port this Repository runs on. Stop it, then start the dev server again.`;
export const singlePortMoved = (expected: number, actual: number): string =>
  `The dev server listened on port ${actual} instead of ${expected}. Unframed now runs this Repository on port ${actual}.`;
export const stoppedForBudget = "Unframed stopped this branch's dev server to stay within the memory budget.";
export const stoppedWhenIdle = "Unframed stopped this branch's dev server after it sat unused with no file changes.";
export const proxyFailed = (reason: string): string => `Unframed could not open the proxy for this worktree: ${reason}`;
export const setupFailed = (code: number | null): string => `The setup command failed${code === null ? "" : ` with code ${code}`}.`;

const PACKAGE_MANAGERS: ReadonlyArray<PackageManager> = ["npm", "pnpm", "yarn", "bun"];
const DOUBLE_DASH_MANAGERS: ReadonlyArray<string> = ["npm", "bun"];
const VITE_FAMILY = /(^|[\s/;&|])(vite|react-router\s+dev|remix\s+vite:dev|svelte-kit\s+dev)(\s|$)/;
const PORT_FROM_ENV_ONLY = /(^|[\s/;&|])react-scripts\s+start(\s|$)/;

const scriptNameOf = (words: ReadonlyArray<string>): string | undefined => {
  const [manager, second, third] = words;
  if (manager === undefined || !PACKAGE_MANAGERS.includes(manager as PackageManager)) return undefined;
  return second === "run" || second === "run-script" ? third : second;
};

export interface ShapedRunCommand {
  readonly command: string;
  readonly env: { readonly PORT: string };
}

export const shapeRunCommand = (input: { readonly command: string; readonly port: number; readonly scripts: Readonly<Record<string, string>> }): ShapedRunCommand => {
  const command = input.command.trim();
  const env = { PORT: String(input.port) };
  const words = command.split(/\s+/);
  const scriptName = scriptNameOf(words);
  const body = scriptName === undefined ? command : (input.scripts[scriptName] ?? "");
  if (PORT_FROM_ENV_ONLY.test(body)) return { command, env };
  const flags = ["--port", String(input.port), ...(VITE_FAMILY.test(body) ? ["--strictPort"] : [])];
  const separator = scriptName !== undefined && DOUBLE_DASH_MANAGERS.includes(words[0]!) && !words.includes("--") ? ["--"] : [];
  return { command: [command, ...separator, ...flags].join(" "), env };
};

const MAX_BRANCH_SLUG = 40;

export const branchSlug = (branch: string): string =>
  branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BRANCH_SLUG)
    .replace(/-+$/g, "") || "branch";

export const defaultInstanceBranch = (id: string): string => `unframed/${id}`;

export const worktreePath = (dataDir: string, repository: string, branch: string, id: string): string =>
  `${dataDir.replace(/[\\/]+$/, "")}/worktrees/${repository}/${branchSlug(branch)}-${id}`;

export const mergeExclude = (existing: string, entries: ReadonlyArray<string>): string => {
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing: string[] = [];
  for (const entry of entries) {
    if (present.has(entry)) continue;
    present.add(entry);
    missing.push(entry);
  }
  if (missing.length === 0) return existing;
  const base = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${base}${missing.join("\n")}\n`;
};

export const copiedEnvFiles = (paths: ReadonlyArray<string>): string[] =>
  paths.filter((path) => {
    const parts = path.split("/");
    return !parts.includes("node_modules") && (parts.at(-1) ?? "").startsWith(".env");
  });

const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

const parsedPackage = (text: string): { packageManager?: unknown; scripts?: unknown } => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as { packageManager?: unknown; scripts?: unknown }) : {};
  } catch {
    return {};
  }
};

export const packageScripts = (packageJson: string | undefined): Record<string, string> => {
  const scripts = packageJson === undefined ? undefined : parsedPackage(packageJson).scripts;
  if (typeof scripts !== "object" || scripts === null) return {};
  return Object.fromEntries(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
};

export const inferredSetup = (input: { readonly packageJson: string | undefined; readonly files: ReadonlyArray<string> }): RepositorySetup | null => {
  if (input.packageJson === undefined) return null;
  const declared = parsedPackage(input.packageJson).packageManager;
  const named = typeof declared === "string" ? PACKAGE_MANAGERS.find((manager) => declared.startsWith(`${manager}@`)) : undefined;
  const packageManager = named ?? LOCKFILES.find(([file]) => input.files.includes(file))?.[1] ?? "npm";
  const scripts = packageScripts(input.packageJson);
  const script = ["dev", "start"].find((name) => scripts[name] !== undefined);
  return {
    setupCommand: `${packageManager} install`,
    runCommand: script === undefined ? "" : `${packageManager} run ${script}`,
    packageManager,
    portMode: { mode: "free" },
    files: [],
    mocks: [],
    warnings: [],
  };
};

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const LOOPBACK_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{1,5})/g;

export const listenedPorts = (output: string): number[] => {
  const ports: number[] = [];
  for (const match of output.replace(ANSI, "").matchAll(LOOPBACK_URL)) {
    const port = Number(match[1]);
    if (port > 0 && port < 65536 && !ports.includes(port)) ports.push(port);
  }
  return ports;
};

export const appendLogTail = (tail: string, chunk: string, maxChars: number): string => {
  const next = tail + chunk;
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
};

export const setupFilePath = (file: string): string | undefined => {
  const trimmed = file.trim().replace(/^\.\/+/, "");
  if (trimmed === "" || trimmed.startsWith("/") || /\\|\0/.test(trimmed)) return undefined;
  const parts = trimmed.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..") || parts[0] === ".git") return undefined;
  return parts.join("/");
};

export const setupFileOutside = (file: string): string => `${file} is not a path inside the worktree.`;
export const setupFileTracked = (file: string): string => `${file} is tracked by git. Setup adds new files only: explain to the person why it would need to change it instead.`;
export const setupFileMissing = (file: string): string => `${file} is not in the worktree.`;
