/**
 * Where the headless Chrome's profiles live, and the sweep that removes what a dead engine
 * left there. Every engine on this machine (any checkout, any worktree) shares one root under
 * the temp folder; each profile is named after the engine that owns it, `engine-<pid>-<random>`.
 * Only processes started with `--user-data-dir` inside this root are ever killed, so the
 * person's own Chrome is never touched.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAlive, killGroup } from "../lifeline.ts";

export const chromeProfileRoot = (): string => join(tmpdir(), "unframed-headless-chrome");

export const makeChromeProfile = async (root = chromeProfileRoot()): Promise<string> => {
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, `engine-${process.pid}-`));
};

const ownerOf = (name: string): number | undefined => {
  const pid = /^engine-(\d+)-/.exec(name)?.[1];
  return pid === undefined ? undefined : Number(pid);
};

/** A profile whose engine is gone. A profile named after this process was left by an earlier one with the same pid. */
const isOrphaned = (name: string): boolean => {
  const owner = ownerOf(name);
  return owner !== undefined && (owner === process.pid || !isAlive(owner));
};

const listProcesses = (): Promise<Array<{ pid: number; ppid: number; command: string }>> =>
  new Promise((resolve) => {
    execFile("ps", ["-axww", "-o", "pid=,ppid=,command="], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([]);
      const rows: Array<{ pid: number; ppid: number; command: string }> = [];
      for (const line of stdout.split("\n")) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! });
      }
      resolve(rows);
    });
  });

/**
 * Kills every Chrome process whose profile is in `root` and whose engine is gone (or whose
 * parent is already pid 1), then deletes the orphaned profiles. Answers what it removed.
 */
export const sweepChromeProfiles = async (root = chromeProfileRoot()): Promise<{ killed: number[]; removed: string[] }> => {
  const names = await readdir(root).catch(() => [] as string[]);
  const killed: number[] = [];
  if (process.platform !== "win32") {
    const marker = `--user-data-dir=${root}/`;
    for (const row of await listProcesses()) {
      const at = row.command.indexOf(marker);
      if (at < 0 || row.pid === process.pid) continue;
      const name = row.command.slice(at + marker.length).split(/[/\s]/, 1)[0] ?? "";
      if (row.ppid === 1 || isOrphaned(name)) {
        killGroup(row.pid);
        killed.push(row.pid);
      }
    }
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!isOrphaned(name)) continue;
    await rm(join(root, name), { recursive: true, force: true }).catch(() => undefined);
    removed.push(name);
  }
  return { killed, removed };
};
