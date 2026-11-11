import { describe, expect, it } from "vitest";
import { connectionNameProblem, trimConnectionName } from "../../src/index.ts";

describe("connection names", () => {
  it.each([
    ["", "Name the connection."],
    ["   ", "Name the connection."],
    ["x".repeat(41), "Keep the name to 40 characters."],
  ])("refuses %j", (name, problem) => {
    expect(connectionNameProblem(name)).toBe(problem);
  });

  it("accepts 40 characters once trimmed", () => {
    expect(connectionNameProblem(`  ${"x".repeat(40)}  `)).toBeUndefined();
    expect(trimConnectionName("  Work laptop  ")).toBe("Work laptop");
  });
});

