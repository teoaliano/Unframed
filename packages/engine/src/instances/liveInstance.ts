import type { Instance } from "@unframed/contracts";
import { logTail } from "@unframed/domain";

export const LIVE_TIMEOUT_MS = 90_000;

export class NotLive extends Error {}

export const untilLive = async (start: () => Promise<Instance>, status: () => Promise<Instance>, timeoutMs = LIVE_TIMEOUT_MS): Promise<Instance & { readonly proxyPort: number }> => {
  let instance = await start();
  const deadline = Date.now() + timeoutMs;
  while (instance.state !== "live" || instance.proxyPort === null) {
    if (instance.state === "failed") throw new NotLive(`the Instance failed: ${instance.error ?? "its dev server stopped"}\n${logTail(instance.log, 20)}`);
    if (instance.state === "removed") throw new NotLive("that Screen's Instance was removed");
    if (Date.now() > deadline) throw new NotLive(`the Instance is still ${instance.state} after ${Math.round(timeoutMs / 1000)} s; read instance_status for its log`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    instance = await status();
  }
  return instance as Instance & { readonly proxyPort: number };
};
