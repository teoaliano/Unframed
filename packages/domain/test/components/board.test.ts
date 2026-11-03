import { describe, expect, it } from "vitest";
import { boardCells } from "../../src/index.ts";

describe("boardCells", () => {
  it("lists every combination with the first variant slowest", () => {
    const board = boardCells({ variants: { kind: ["primary", "secondary"], size: ["md", "sm", "lg"] } });
    expect(board.line).toBeUndefined();
    expect(board.cells.map((cell) => cell.label)).toEqual([
      "primary · md",
      "primary · sm",
      "primary · lg",
      "secondary · md",
      "secondary · sm",
      "secondary · lg",
    ]);
    expect(board.cells[4]?.values).toEqual({ kind: "secondary", size: "sm" });
  });

  it("shows one Default cell for a component with no variants", () => {
    expect(boardCells({ variants: {} })).toEqual({ cells: [{ values: {}, label: "Default" }] });
  });

  it("shows up to 48 combinations as a grid", () => {
    const board = boardCells({ variants: { a: ["1", "2", "3", "4"], b: ["1", "2", "3", "4"], c: ["1", "2", "3"] } });
    expect(board.cells).toHaveLength(48);
    expect(board.line).toBeUndefined();
  });

  it("shows one row per variant above 48 combinations, others at their defaults", () => {
    const board = boardCells({ variants: { a: ["1", "2", "3", "4", "5", "6", "7"], b: ["x", "y", "z", "w", "v", "u", "t"], c: ["p", "q", "r", "s", "o", "n", "m"] } });
    expect(board.line).toBe("343 combinations; showing each variant on its own.");
    expect(board.cells).toHaveLength(21);
    expect(board.cells.slice(0, 7).map((cell) => cell.values)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7"].map((a) => ({ a, b: "x", c: "p" })),
    );
    expect(board.cells[7]?.label).toBe("1 · x · p");
    expect(board.cells[7]?.values).toEqual({ a: "1", b: "x", c: "p" });
    expect(board.cells[14]?.values).toEqual({ a: "1", b: "x", c: "p" });
    expect(board.cells[14]?.label).toBe("1 · x · p");
    expect(board.cells[20]?.values).toEqual({ a: "1", b: "x", c: "m" });
  });
});
