import type { SourceEdit } from "@unframed/contracts";
import { cssName, TEXT_STYLE_SUFFIX, type Kit } from "../kits/index.ts";

export const framePatchesOf = (edit: SourceEdit, kit: Kit | null): SourceEdit[] => {
  if (edit.type !== "token") return [edit];
  if (edit.elementId === undefined) return [];
  const elementId = edit.elementId;
  const token = kit?.tokens.find((candidate) => candidate.path === edit.token);
  if (token === undefined) return [];
  const name = cssName(token.path);
  if (token.type === "textStyle") {
    return Object.values(TEXT_STYLE_SUFFIX).map((suffix) => ({ type: "style", elementId, property: suffix, value: `var(${name}-${suffix})` }));
  }
  return [{ type: "style", elementId, property: edit.property, value: `var(${name})` }];
};
