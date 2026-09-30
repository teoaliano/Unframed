import { unframedError } from "@unframed/contracts";
import { internalErrorMessage } from "@unframed/domain";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { errorText, logError, stackText } from "../log.ts";

const onDefect = (method: string, defect: unknown) => {
  logError(`${method} failed: ${stackText(defect)}`);
  return unframedError("internal", internalErrorMessage(errorText(defect)));
};

/**
 * The RPC server boundary for defects: an unexpected throw inside a handler, or an
 * effect or stream that dies, is logged and answered `internal`, never let through as a
 * defect that would end the client's connection.
 */
export const guardHandlers = <H extends Record<string, (payload: any, options: any) => unknown>>(handlers: H): H => {
  const guarded: Record<string, (payload: unknown, options: unknown) => unknown> = {};
  for (const [method, handler] of Object.entries(handlers)) {
    guarded[method] = (payload, options) => {
      let result: unknown;
      try {
        result = handler(payload, options);
      } catch (defect) {
        return Effect.fail(onDefect(method, defect));
      }
      if (Stream.isStream(result)) {
        return Stream.catchDefect(result as Stream.Stream<unknown, unknown>, (defect) =>
          Stream.fail(onDefect(method, defect)),
        );
      }
      if (Effect.isEffect(result)) {
        return Effect.catchDefect(result as Effect.Effect<unknown, unknown>, (defect) =>
          Effect.fail(onDefect(method, defect)),
        );
      }
      return result;
    };
  }
  return guarded as H;
};
