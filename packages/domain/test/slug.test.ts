import { describe, expect, it } from "vitest";
import { projectSlug } from "../src/index.ts";

describe("project slug", () => {
  it("lowercases and keeps letters and digits", () => {
    expect(projectSlug("Summer2026")).toBe("summer2026");
  });

  it("turns every run of other characters into one dash", () => {
    expect(projectSlug("My  new   project")).toBe("my-new-project");
    expect(projectSlug("a!!b__c..d")).toBe("a-b-c-d");
    expect(projectSlug("Café & Crème")).toBe("caf-cr-me");
  });

  it("removes leading and trailing dashes", () => {
    expect(projectSlug("  --Hello--  ")).toBe("hello");
    expect(projectSlug("***x***")).toBe("x");
  });

  it("cuts the result to 40 characters", () => {
    const slug = projectSlug("a".repeat(50));
    expect(slug).toBe("a".repeat(40));
    expect(slug).toHaveLength(40);
  });

  it("cuts after removing the dashes, in the order the rule gives", () => {
    expect(projectSlug(`--${"c".repeat(45)}`)).toBe("c".repeat(40));
    expect(projectSlug(`${"b".repeat(39)} tail`)).toBe(`${"b".repeat(39)}-`);
  });

  it("stops a name escaping the output folder", () => {
    expect(projectSlug("../../etc")).toBe("etc");
    expect(projectSlug("..")).toBe("");
    expect(projectSlug("/")).toBe("");
  });

  it("gives an empty result for a name with nothing usable", () => {
    expect(projectSlug("")).toBe("");
    expect(projectSlug("   ")).toBe("");
    expect(projectSlug("!!!")).toBe("");
  });
});
