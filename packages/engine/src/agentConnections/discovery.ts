import { closeSync, fsyncSync, openSync, renameSync, writeSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { ENGINE_VERSION } from "../agent/version.ts";

/**
 * The discovery file (spec 14): where this engine listens right now, for the stdio shim. It is
 * written in every run, just after the ready message. The write is synchronous on purpose: no
 * write is ever pending when `stop` runs, so a shutdown cannot leave a file behind.
 */
export const writeDiscovery = (path: string, port: number, startedAt: Date): void => {
  const text = `${JSON.stringify({ port, pid: process.pid, version: ENGINE_VERSION, startedAt: startedAt.toISOString() })}\n`;
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, "w", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
};

/** Removes the file only when it still names this engine: a newer engine's file stays. */
export const removeDiscovery = async (path: string): Promise<void> => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
    if (parsed.pid === process.pid) await rm(path, { force: true });
  } catch {
    // Missing or unreadable: there is nothing of ours to remove.
  }
};
