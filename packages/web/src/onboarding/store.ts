import { ONBOARDING_KEY, readOnboarding, seeOnboarding, startOnboarding, type OnboardingState, type SeenStep } from "@unframed/domain";
import { useEffect, useState } from "react";
import type { EngineConnection } from "../rpc/engine.ts";

export const useOnboarding = (engine: EngineConnection): OnboardingState | undefined => {
  const [state, setState] = useState<OnboardingState | undefined>(undefined);
  useEffect(
    () =>
      engine.subscribe("preferences.subscribe", { keys: [ONBOARDING_KEY] }, (change) => {
        if (change.key === ONBOARDING_KEY) setState(readOnboarding(change.value));
      }),
    [engine],
  );
  return state;
};

const write = (engine: EngineConnection, state: OnboardingState): Promise<void> =>
  engine.call("preferences.set", { key: ONBOARDING_KEY, value: state }).then(
    () => undefined,
    () => undefined,
  );

export const seeStep = (engine: EngineConnection, state: OnboardingState, step: SeenStep): Promise<void> => {
  const next = seeOnboarding(state, step);
  return next === state ? Promise.resolve() : write(engine, next);
};

export const finishOnboarding = (engine: EngineConnection, state: OnboardingState): Promise<void> => write(engine, { ...state, done: true });

export const restartOnboarding = (engine: EngineConnection): Promise<void> => write(engine, startOnboarding());
