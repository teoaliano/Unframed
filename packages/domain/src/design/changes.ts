import type { ScreenWrite } from "@unframed/contracts";
import type { DraftChange, DraftElement, DraftNeighbour, PropValue } from "../screenDrafts.ts";
import type { Sides } from "./gestures.ts";

export type StructuralEdit =
  | { readonly type: "reorder"; readonly from: number; readonly to: number; readonly siblings: ReadonlyArray<DraftNeighbour>; readonly parent: DraftNeighbour | null }
  | { readonly type: "duplicate"; readonly parent: DraftNeighbour | null }
  | { readonly type: "delete"; readonly parent: DraftNeighbour | null }
  | { readonly type: "wrap" }
  | { readonly type: "hide" }
  | { readonly type: "props"; readonly props: Readonly<Record<string, PropValue>>; readonly before: Readonly<Record<string, PropValue>> };

export const STRUCTURAL_PROPERTY = { reorder: "#order", duplicate: "#duplicate", delete: "#delete", wrap: "#wrap", hide: "display", props: "#props" } as const;

export const structuralDraftOf = (edit: StructuralEdit, context: { readonly id: string; readonly element: DraftElement }): DraftChange => ({
  id: context.id,
  element: context.element,
  scope: "all",
  kind: edit.type,
  property: STRUCTURAL_PROPERTY[edit.type],
  before: null,
  after: null,
  shownBefore: "",
  asked: null,
});

export const changeLine = (change: DraftChange): string => change.property;

export const paddingLine = (_before: Sides, _after: Sides, _token?: { readonly name: string; readonly label?: string }): string => "Padding";

export const groupLine = (changes: ReadonlyArray<DraftChange>): string => changes.map(changeLine).join(" · ");

export const screenWritesOf = (_change: DraftChange): ScreenWrite[] => [];
