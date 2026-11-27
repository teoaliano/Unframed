import type { TokenScale, UnframedError } from "@unframed/contracts";
import { EMPTY_SCALE } from "@unframed/domain";
import * as Effect from "effect/Effect";

export const makeScreenTokens = (worktreeOf: (project: string, instance: string) => Effect.Effect<string, UnframedError>) => {
  const read = (input: { project: string; instance: string }): Effect.Effect<{ revision: string; scale: TokenScale }, UnframedError> =>
    Effect.map(worktreeOf(input.project, input.instance), () => ({ revision: "", scale: EMPTY_SCALE }));
  return { read };
};
