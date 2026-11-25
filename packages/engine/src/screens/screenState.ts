import { checkMocks, checkSteps } from "@unframed/domain";
import type { ScreenStatePayload } from "../instances/stateTokens.ts";

export const screenStatePayload = (props: { readonly steps?: unknown; readonly mocks?: unknown }): ScreenStatePayload | undefined => {
  const steps = checkSteps(props.steps);
  const mocks = checkMocks(props.mocks);
  const payload = { steps: "steps" in steps ? steps.steps : [], mocks: "mocks" in mocks ? mocks.mocks : [] };
  return payload.steps.length === 0 && payload.mocks.length === 0 ? undefined : payload;
};
