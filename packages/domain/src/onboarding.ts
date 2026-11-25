export const ONBOARDING_KEY = "onboarding";

export const ONBOARDING_STEPS = ["agent", "project", "rail", "prototype", "generate"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type SeenStep = Exclude<OnboardingStep, "agent" | "project">;
const SEEN: ReadonlyArray<SeenStep> = ["rail", "prototype", "generate"];

export interface OnboardingState {
  readonly done: boolean;
  readonly seen: ReadonlyArray<SeenStep>;
}

export interface OnboardingLive {
  readonly agentReady: boolean;
  readonly projectOpen: boolean;
}

export type StepStatus = "done" | "current" | "todo";

export const ONBOARDING_PROTOTYPE_PROMPT =
  "Build a landing page for Ember & Oak, a neighbourhood coffee shop: a hero with the name and a short tagline, a menu of six drinks with prices, opening hours, and a footer with the address. Warm and modern, and it should work on a phone.";

export const startOnboarding = (): OnboardingState => ({ done: false, seen: [] });

export const readOnboarding = (value: unknown): OnboardingState | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { done, seen } = value as { done?: unknown; seen?: unknown };
  return {
    done: done === true,
    seen: Array.isArray(seen) ? SEEN.filter((step) => seen.includes(step)) : [],
  };
};

export const seeOnboarding = (state: OnboardingState, step: SeenStep): OnboardingState =>
  state.seen.includes(step) ? state : { ...state, seen: SEEN.filter((each) => each === step || state.seen.includes(each)) };

export const onboardingSteps = (state: OnboardingState, live: OnboardingLive): ReadonlyArray<{ readonly id: OnboardingStep; readonly status: StepStatus }> => {
  const done = (step: OnboardingStep): boolean => (step === "agent" ? live.agentReady : step === "project" ? live.projectOpen : state.seen.includes(step));
  const current = ONBOARDING_STEPS.find((step) => !done(step));
  return ONBOARDING_STEPS.map((id) => ({ id, status: done(id) ? "done" : id === current ? "current" : "todo" }));
};
