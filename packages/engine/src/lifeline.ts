/**
 * Ties a process's children to its life. `watchParent` notices that whoever started this
 * process is gone; `spawnReaper` cleans up after this process even when it is killed with
 * SIGKILL and nothing in it gets to run. Node builtins only: `scripts/dev.ts` imports this.
 */
import { spawn } from "node:child_process";
import type { Socket } from "node:net";

const POLL_MS = 1000;

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** SIGKILL to `pid`'s process group when it leads one, and to `pid` itself. */
export const killGroup = (pid: number): void => {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // not a group leader, or already gone
    }
  }
};

/**
 * Calls `onGone` once when the parent process dies: the IPC channel closing (a fork) or the
 * parent pid changing or vanishing (anything else). A process whose parent is already pid 1
 * was started that way on purpose and is not watched by pid.
 */
export const watchParent = (onGone: () => void): void => {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    clearInterval(timer);
    onGone();
  };
  if (typeof process.send === "function") process.once("disconnect", fire);
  const parent = process.ppid;
  const timer = setInterval(() => {
    if (process.ppid !== parent || !isAlive(parent)) fire();
  }, POLL_MS);
  timer.unref();
  if (parent <= 1) clearInterval(timer);
};

/**
 * Waits until its stdin closes, which happens when the process that spawned it dies however it
 * dies. Then each `kill:<pid>` gets SIGTERM (its process group when it leads one) and up to
 * `$1` tenths of a second to exit, then SIGKILL; every process whose command line matches a
 * `match:<regex>` gets SIGKILL; and each `path:<path>` is deleted. It ignores
 * the terminal's signals so a Ctrl-C to the whole group cannot stop it before it acts.
 */
const REAPER_SCRIPT = `
trap '' INT HUP TERM
while read -r _; do :; done
grace=$1
shift
signal() {
  sig=$1
  shift
  for target do
    case $target in kill:*) pid=\${target#kill:}; kill -$sig -$pid 2>/dev/null || kill -$sig $pid 2>/dev/null ;; esac
  done
}
alive() {
  for target do
    case $target in kill:*) kill -0 \${target#kill:} 2>/dev/null && return 0 ;; esac
  done
  return 1
}
if [ "$grace" -gt 0 ]; then
  signal TERM "$@"
  waited=0
  while [ $waited -lt $grace ] && alive "$@"; do sleep 0.1; waited=$((waited + 1)); done
fi
signal KILL "$@"
for target do
  case $target in match:*) pkill -KILL -f -- "\${target#match:}" 2>/dev/null ;; esac
done
remove() {
  left=1
  for target do
    case $target in path:*) rm -rf -- "\${target#path:}" 2>/dev/null; [ -e "\${target#path:}" ] && left=0 ;; esac
  done
  return $left
}
remove "$@" && sleep 0.3 && remove "$@"
`;

export interface Reaper {
  /** Stops the reaper without it doing anything: the caller cleaned up itself. */
  dismiss(): void;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Starts a detached `sh` that cleans up once this process is gone: `kill` pids get `graceMs`
 * after SIGTERM before SIGKILL (none by default), processes whose command line contains a
 * `matching` string get SIGKILL, and `paths` are deleted. `undefined` on Windows.
 */
export const spawnReaper = (targets: {
  readonly kill?: ReadonlyArray<number>;
  readonly matching?: ReadonlyArray<string>;
  readonly paths?: ReadonlyArray<string>;
  readonly graceMs?: number;
}): Reaper | undefined => {
  if (process.platform === "win32") return undefined;
  const args = [
    String(Math.round((targets.graceMs ?? 0) / 100)),
    ...(targets.kill ?? []).map((pid) => `kill:${pid}`),
    ...(targets.matching ?? []).map((text) => `match:${escapeRegex(text)}`),
    ...(targets.paths ?? []).map((path) => `path:${path}`),
  ];
  try {
    const child = spawn("/bin/sh", ["-c", REAPER_SCRIPT, "unframed-reaper", ...args], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => {});
    child.stdin?.on("error", () => {});
    child.unref();
    (child.stdin as Socket | null)?.unref();
    return {
      dismiss() {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        child.stdin?.destroy();
      },
    };
  } catch {
    return undefined;
  }
};
