/**
 * The variant board rule (spec 20): which combinations a sheet shows on its own, and their
 * labels. Up to 48 combinations, a grid with the first variant slowest. Above that, one row
 * per variant, each varying that variant with the others at their defaults.
 */
import type { ComponentDeclaration } from "./sheet.ts";

export const BOARD_CAP = 48;

export type BoardCell = { readonly values: Readonly<Record<string, string>>; readonly label: string };

export type BoardCells = { readonly cells: readonly BoardCell[]; readonly line?: string };

/**
 * The rule itself, with no reference to this module, so the sheet helper can carry its text
 * (`boardCellsRule.toString()`), as the dials bridge carries its rules.
 */
export const boardCellsRule = (declaration: Pick<ComponentDeclaration, "variants">, cap: number): BoardCells => {
  const labelOf = (values: Readonly<Record<string, string>>, names: readonly string[]): string =>
    names.length === 0 ? "Default" : names.map((name) => values[name]).join(" · ");
  const names = Object.keys(declaration.variants);
  const lists = names.map((name) => declaration.variants[name] ?? []);
  const defaults: Record<string, string> = {};
  names.forEach((name, index) => {
    defaults[name] = lists[index]?.[0] ?? "";
  });
  const total = lists.reduce((product, list) => product * list.length, 1);

  if (total <= cap) {
    const cells: BoardCell[] = [];
    for (let index = 0; index < total; index++) {
      const values: Record<string, string> = {};
      let stride = total;
      names.forEach((name, axis) => {
        const list = lists[axis] ?? [];
        stride /= list.length;
        values[name] = list[Math.floor(index / stride) % list.length] ?? "";
      });
      cells.push({ values, label: labelOf(values, names) });
    }
    if (cells.length === 0) cells.push({ values: {}, label: "Default" });
    return { cells };
  }

  const cells: BoardCell[] = [];
  names.forEach((name, axis) => {
    for (const value of lists[axis] ?? []) {
      const values = { ...defaults, [name]: value };
      cells.push({ values, label: labelOf(values, names) });
    }
  });
  return { cells, line: `${total} combinations; showing each variant on its own.` };
};

export const boardCells = (declaration: Pick<ComponentDeclaration, "variants">): BoardCells => boardCellsRule(declaration, BOARD_CAP);
