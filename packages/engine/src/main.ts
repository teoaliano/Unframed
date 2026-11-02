/**
 * The fork entry. The desktop shell forks this file (as `server/index.js` in the
 * bundle); a clone runs it with `pnpm engine` or `pnpm dev`.
 */
import type { EngineIpcMessage } from "@unframed/contracts";
import { startEngine } from "./engine.ts";
import { watchParent } from "./lifeline.ts";
import { errorText, logError, stackText } from "./log.ts";

/** The shell gives up 2 s after SIGTERM, so the engine exits by this point whatever is still running. */
const EXIT_DEADLINE_MS = 1900;

let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let stopping = false;

/** Runs the shutdown hooks (when the engine is up) and exits with `code`, by the deadline at the latest. */
const shutdown = (code: number) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  if (engine === undefined) process.exit(code);
  setTimeout(() => process.exit(code), EXIT_DEADLINE_MS).unref();
  engine.stop().then(
    () => process.exit(code),
    (error: unknown) => {
      logError(`shutdown failed: ${stackText(error)}`);
      process.exit(code);
    },
  );
};

process.on("unhandledRejection", (reason) => {
  logError(`unhandled rejection: ${stackText(reason)}`);
});
process.on("uncaughtException", (error) => {
  logError(`uncaught exception: ${stackText(error)}`);
  shutdown(1);
});
if (process.env.UNFRAMED_TEST_UNCAUGHT === "1") {
  process.on("SIGUSR2", () =>
    setImmediate(() => {
      throw new Error("UNFRAMED_TEST_UNCAUGHT: thrown on SIGUSR2");
    }),
  );
}

const send =
  typeof process.send === "function"
    ? (message: EngineIpcMessage) => {
        if (process.connected) process.send?.(message);
      }
    : undefined;

try {
  engine = await startEngine({ env: process.env, platform: process.platform, send });
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  // Whoever started the engine is gone (the shell crashed, a test runner was killed): nobody can stop it any more.
  watchParent(() => {
    logError("the process that started the engine is gone; stopping");
    shutdown(0);
  });
} catch (error) {
  logError(errorText(error));
  process.exit(1);
}
