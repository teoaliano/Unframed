import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "../atomicFile.ts";
import { ENGINE_VERSION } from "../agent/version.ts";

/**
 * The discovery file (spec 14): where this engine listens right now, for the stdio shim. It is
 * written in every run, after the API port is bound and before the ready message.
 */
export const writeDiscovery = (path: string, port: number, startedAt: Date): Promise<void> =>
  writeFileAtomic(path, `${JSON.stringify({ port, pid: process.pid, version: ENGINE_VERSION, startedAt: startedAt.toISOString() })}\n`);

/** Removes the file only when it still names this engine: a newer engine's file stays. */
export const removeDiscovery = async (path: string): Promise<void> => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
    if (parsed.pid === process.pid) await rm(path, { force: true });
  } catch {
    // Missing or unreadable: there is nothing of ours to remove.
  }
};
