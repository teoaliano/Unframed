/**
 * The fork entry. The desktop shell forks this file (as `server/index.js` in the
 * bundle); a clone runs it with `pnpm engine` or `pnpm dev`.
 */
import type { EngineIpcMessage } from "@unframed/contracts";
import { startEngine } from "./engine.ts";
import { errorText, logError, stackText } from "./log.ts";

/** The shell waits this long after SIGTERM before giving up on the engine. */
const EXIT_DEADLINE_MS = 1900;

process.on("unhandledRejection", (reason) => {
  logError(`unhandled rejection: ${stackText(reason)}`);
});
process.on("uncaughtException", (error) => {
  logError(`uncaught exception: ${stackText(error)}`);
  process.exit(1);
});

const send =
  typeof process.send === "function"
    ? (message: EngineIpcMessage) => {
        if (process.connected) process.send?.(message);
      }
    : undefined;

try {
  const engine = await startEngine({ env: process.env, platform: process.platform, send });
  let stopping = false;
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(0), EXIT_DEADLINE_MS).unref();
    engine.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logError(`shutdown failed: ${stackText(error)}`);
        process.exit(0);
      },
    );
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
} catch (error) {
  logError(errorText(error));
  process.exit(1);
}
