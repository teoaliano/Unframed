import type { RepoAnalysis, SourceFiles } from "./types.ts";
import { codeMapOf, mergeCodeMap } from "./codeMap.ts";
import { designSystemOf } from "./designSystem.ts";
import { mergeStatesIndex, statesIndexOf } from "./states.ts";

export const analyseRepository = (files: SourceFiles, previous: Partial<RepoAnalysis> = {}): RepoAnalysis => {
  const codeMap = mergeCodeMap(previous.codeMap, codeMapOf(files));
  return {
    codeMap,
    designSystem: designSystemOf(files),
    states: mergeStatesIndex(previous.states, statesIndexOf(files, codeMap.routes)),
  };
};
