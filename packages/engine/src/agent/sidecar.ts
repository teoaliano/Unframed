import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TurnSidecar {
  readonly chatId: string;
  readonly turn: number;
  readonly provider: string;
  readonly model: string;
  readonly usage: unknown;
  readonly estimatedUsd?: number;
  readonly durationMs?: number;
}

/**
 * Writes an agent turn's sidecar, `<epochMs>-agent[-n].json`, into the project folder at
 * the first free name. It never has a `cost` field: an agent turn runs on the person's
 * subscription, and a zero would corrupt a spend sum.
 */
export const writeTurnSidecar = async (folder: string, sidecar: TurnSidecar, now = Date.now()): Promise<string> => {
  const body = {
    kind: "agent-turn",
    chatId: sidecar.chatId,
    turn: sidecar.turn,
    provider: sidecar.provider,
    model: sidecar.model,
    billing: "subscription",
    usage: sidecar.usage ?? {},
    ...(typeof sidecar.estimatedUsd === "number" && Number.isFinite(sidecar.estimatedUsd) ? { estimatedUsd: sidecar.estimatedUsd } : {}),
    ...(typeof sidecar.durationMs === "number" && Number.isFinite(sidecar.durationMs) ? { durationMs: sidecar.durationMs } : {}),
    at: new Date(now).toISOString(),
  };
  const text = `${JSON.stringify(body, null, 2)}\n`;
  for (let n = 0; n < 1000; n++) {
    const name = `${now}-agent${n === 0 ? "" : `-${n}`}.json`;
    try {
      await writeFile(join(folder, name), text, { flag: "wx" });
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("No free sidecar name.");
};
