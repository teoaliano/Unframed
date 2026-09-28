/**
 * The engine seam for Vitest: the framework-free harness in `engineProcess.ts`, with every
 * engine and temp folder a test makes cleaned up when that test finishes.
 */
import { onTestFinished } from "vitest";
import { setCleanupRegistrar } from "./engineProcess.ts";

setCleanupRegistrar((cleanup) => {
  try {
    onTestFinished(cleanup);
  } catch {
    // Called from a beforeAll: the caller disposes.
  }
});

export * from "./engineProcess.ts";
