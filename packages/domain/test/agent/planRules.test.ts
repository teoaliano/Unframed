import { describe, expect, it } from "vitest";
import { actionablePlan, collapsedPlanPreview, implementPlanText, implementPlanTitle, planCollapses, planFileName, planTitle, shownPlan } from "../../src/index.ts";

const PLAN = "# Landing page\n\n## Summary\n\nOne page.\n\n## Steps\n\n- Write it.";

describe("a proposed plan, as its card and Implement read it", () => {
  it("takes its title from the first heading, else none", () => {
    expect(planTitle(PLAN)).toBe("Landing page");
    expect(planTitle("  ## Indented heading\nbody")).toBe("Indented heading");
    expect(planTitle("No heading here")).toBeUndefined();
  });

  it("names a new chat and a download after the title", () => {
    expect(implementPlanTitle(PLAN)).toBe("Implement Landing page");
    expect(implementPlanTitle("No heading")).toBe("Implement plan");
    expect(planFileName("# Landing page, v2 (draft)!")).toBe("landing-page-v2-draft.md");
    expect(planFileName("no heading")).toBe("plan.md");
  });

  it("sends the prefix and the trimmed plan with nothing between them", () => {
    expect(implementPlanText(`\n\n${PLAN}\n  `)).toBe(`PLEASE IMPLEMENT THIS PLAN:\n${PLAN}`);
    expect(implementPlanText("costs $1 and $&")).toBe("PLEASE IMPLEMENT THIS PLAN:\ncosts $1 and $&");
  });

  it("shows the plan without its title heading or a leading Summary heading", () => {
    expect(shownPlan(PLAN)).toBe("One page.\n\n## Steps\n\n- Write it.");
  });

  it("collapses past 900 characters or 20 lines, previewing 10 lines that carry text", () => {
    expect(planCollapses(PLAN)).toBe(false);
    expect(planCollapses("x".repeat(901))).toBe(true);
    const long = ["# Long", ...Array.from({ length: 24 }, (_, index) => `line ${index + 1}\n`)].join("\n");
    expect(planCollapses(long)).toBe(true);
    const preview = collapsedPlanPreview(long);
    expect(preview.split("\n").filter((line) => line.trim() !== "")).toEqual([...Array.from({ length: 10 }, (_, index) => `line ${index + 1}`), "..."]);
  });

  it("acts on the latest turn's newest plan, else the newest, and on none once implemented", () => {
    const plan = (id: string, turnId: string, updatedAt: string, implementedAt: string | null = null) => ({
      id,
      turnId,
      planMarkdown: "# P",
      implementedAt,
      implementationThreadId: null,
      createdAt: updatedAt,
      updatedAt,
    });
    const latestTurn = { turnId: "t1" } as never;
    expect(actionablePlan({ latestTurn, proposedPlans: [plan("a", "t1", "2026-01-01"), plan("b", "t0", "2026-01-02")] })?.id).toBe("a");
    expect(actionablePlan({ latestTurn: null, proposedPlans: [plan("a", "t1", "2026-01-01"), plan("b", "t0", "2026-01-02")] })?.id).toBe("b");
    expect(actionablePlan({ latestTurn, proposedPlans: [plan("a", "t1", "2026-01-01", "2026-01-03")] })).toBeUndefined();
    expect(actionablePlan({ latestTurn, proposedPlans: [] })).toBeUndefined();
  });
});
