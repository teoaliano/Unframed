import { describe, expect, it } from "vitest";
import { connectionNameProblem, outsideChatTitle, trimConnectionName } from "../../src/index.ts";

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

describe("outside chat titles", () => {
  it.each([
    [new Date(2026, 9, 14, 0, 5), "Claude Code · 12:05 am"],
    [new Date(2026, 9, 14, 11, 59), "Claude Code · 11:59 am"],
    [new Date(2026, 9, 14, 12, 0), "Claude Code · 12:00 pm"],
    [new Date(2026, 9, 14, 15, 42), "Claude Code · 3:42 pm"],
  ])("titles %s", (when, title) => {
    expect(outsideChatTitle("Claude Code", when)).toBe(title);
  });
});
