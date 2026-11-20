import { describe, expect, it } from "vitest";
import { onboardingSteps, readOnboarding, seeOnboarding, startOnboarding, type OnboardingState } from "../src/onboarding.ts";

const fresh: OnboardingState = startOnboarding();
const live = { agentReady: false, projectOpen: false };

const statuses = (state: OnboardingState, now = live) => onboardingSteps(state, now).map((step) => `${step.id}:${step.status}`);

describe("onboarding", () => {
  it("starts open, with nothing seen", () => {
    expect(fresh).toEqual({ done: false, seen: [] });
  });

  it("reads a stored value, and nothing from what is not one", () => {
    expect(readOnboarding({ done: false, seen: ["rail", "bogus", 3] })).toEqual({ done: false, seen: ["rail"] });
    expect(readOnboarding({ done: true })).toEqual({ done: true, seen: [] });
    expect(readOnboarding(undefined)).toBeUndefined();
    expect(readOnboarding(null)).toBeUndefined();
    expect(readOnboarding("done")).toBeUndefined();
  });

  it("points at the first step that is not done", () => {
    expect(statuses(fresh)).toEqual(["agent:current", "project:todo", "rail:todo", "prototype:todo", "generate:todo"]);
    expect(statuses(fresh, { agentReady: true, projectOpen: false })).toEqual(["agent:done", "project:current", "rail:todo", "prototype:todo", "generate:todo"]);
    expect(statuses(fresh, { agentReady: true, projectOpen: true })).toEqual(["agent:done", "project:done", "rail:current", "prototype:todo", "generate:todo"]);
  });

  it("keeps a seen step done, in any order", () => {
    const state = seeOnboarding(seeOnboarding(fresh, "prototype"), "rail");
    expect(statuses(state, { agentReady: true, projectOpen: true })).toEqual(["agent:done", "project:done", "rail:done", "prototype:done", "generate:current"]);
  });

  it("answers the same state for a step already seen", () => {
    const once = seeOnboarding(fresh, "rail");
    expect(seeOnboarding(once, "rail")).toBe(once);
  });

  it("lets the agent step go back to current when the agent stops being ready", () => {
    const state = seeOnboarding(fresh, "rail");
    expect(statuses(state, { agentReady: false, projectOpen: true })[0]).toBe("agent:current");
  });
});
