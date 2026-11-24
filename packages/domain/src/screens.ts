import type { Instance, RepositorySetup, RepositoryStatus } from "@unframed/contracts";
import { NO_RUN_COMMAND } from "./instances.ts";

export interface ScreenViewport {
  readonly name: string;
  readonly w: number;
  readonly h: number;
}

export const SCREEN_VIEWPORTS: ReadonlyArray<ScreenViewport> = [
  { name: "Desktop", w: 1280, h: 800 },
  { name: "Laptop", w: 1440, h: 900 },
  { name: "Tablet", w: 768, h: 1024 },
  { name: "Phone", w: 390, h: 844 },
];

export const SCREEN_DEFAULT_VIEWPORT = SCREEN_VIEWPORTS[0]!;

export const SCREEN_GAP = 80;

export const NO_BRIDGE = "Parameters need Unframed's script in the page, and this page did not load it (a strict CSP, or a response that is not HTML).";

export const screenUrl = (proxyPort: number, route: string): string => `http://127.0.0.1:${proxyPort}${route}`;

const LOOPBACK_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(?=[/?#]|$)/i;

export const normaliseRoute = (input: string): string | undefined => {
  let route = input.trim();
  if (route === "") return undefined;
  const loopback = LOOPBACK_URL.exec(route);
  if (loopback !== null) route = route.slice(loopback[0].length) || "/";
  else if (/^[a-z][a-z0-9+.-]*:/i.test(route)) return undefined;
  if (route.startsWith("?") || route.startsWith("#")) route = `/${route}`;
  if (!route.startsWith("/")) route = `/${route}`;
  if (route.startsWith("//") || /[\s\\]/.test(route) || route.length > 2048) return undefined;
  return route;
};

export type ScreenOverlay =
  | { readonly kind: "none" }
  | { readonly kind: "progress"; readonly label: string; readonly detail?: string }
  | { readonly kind: "waiting"; readonly label: string; readonly detail: string }
  | { readonly kind: "failed"; readonly message: string; readonly log: string }
  | { readonly kind: "removed"; readonly label: string }
  | { readonly kind: "missing"; readonly label: string };

const PROGRESS: Partial<Record<Instance["state"], string>> = {
  creating: "Creating the worktree…",
  installing: "Installing dependencies…",
  starting: "Starting the dev server…",
};

export type SetupChatState = "running" | "asking" | "idle";

export const SETUP_FINDING = "Setup is finding how to run this repository…";
export const SETUP_FOLLOW = "Follow along in the Setup chat.";
export const SETUP_ASKING = "Setup needs your answer";
export const SETUP_ASKING_DETAIL = "Reply in the Setup chat to keep it going.";
export const SETUP_STALLED = "Setup has not found how to run this repository yet";
export const SETUP_STALLED_DETAIL = "Open the Setup chat to keep it going.";

const awaitingSetup = (instance: Instance, repository: RepositoryStatus | undefined, setupChat: SetupChatState | undefined): boolean =>
  (instance.state === "failed" && instance.error === NO_RUN_COMMAND) || (instance.state === "stopped" && repository === "setting-up" && setupChat === "running");

export const screenOverlay = (input: {
  readonly instance: Instance | undefined;
  readonly loaded: boolean;
  readonly repository: RepositoryStatus | undefined;
  readonly setupChat?: SetupChatState | undefined;
}): ScreenOverlay => {
  if (input.repository === "missing") return { kind: "missing", label: "Repository not found" };
  if (!input.loaded) return { kind: "none" };
  const { instance } = input;
  if (instance === undefined || instance.state === "removed") return { kind: "removed", label: "Instance removed" };
  if (awaitingSetup(instance, input.repository, input.setupChat)) {
    if (input.setupChat === "running") return { kind: "progress", label: SETUP_FINDING, detail: SETUP_FOLLOW };
    if (input.setupChat === "asking") return { kind: "waiting", label: SETUP_ASKING, detail: SETUP_ASKING_DETAIL };
    return { kind: "waiting", label: SETUP_STALLED, detail: SETUP_STALLED_DETAIL };
  }
  const progress = PROGRESS[instance.state];
  if (progress !== undefined) return { kind: "progress", label: progress };
  if (instance.state === "failed") return { kind: "failed", message: instance.error ?? "The dev server failed.", log: logTail(instance.log, 8) };
  return { kind: "none" };
};

export const logTail = (log: string, lines: number): string =>
  log
    .split(/\r?\n/)
    .filter((line, index, all) => line !== "" || index < all.length - 1)
    .slice(-lines)
    .join("\n")
    .trimEnd();

export const setupTag = (setup: RepositorySetup | null): string | undefined => (setup === null || setup.mocks.length === 0 ? undefined : setup.mocks.join(" · "));

export const forkBranchName = (branch: string, taken: ReadonlyArray<string>): string => {
  const stem = branch.replace(/-\d+$/, "");
  const used = new Set(taken);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!used.has(candidate) && candidate !== branch) return candidate;
  }
};

export const screenSnapshotName = (shapeId: string): string | undefined => {
  const bare = shapeId.replace(/^shape:/, "");
  return /^[A-Za-z0-9_-]{1,128}$/.test(bare) ? `${bare}.png` : undefined;
};
