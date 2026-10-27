/**
 * Edit bursts (spec 18): the edits the editor collects before it writes them as one version. An
 * edit is keyed by its target and field, so a later edit of the same field replaces the earlier
 * one; dial values are held by path and written with the burst's file in one step.
 */

/** One source edit, the same shape as contracts' `SourceEdit`. Spec 19 and later specs add members. */
export type BurstSourceEdit =
  | { readonly type: "text"; readonly elementId: string; readonly text: string }
  | { readonly type: "style"; readonly elementId: string; readonly property: string; readonly value: string | null }
  | { readonly type: "attribute"; readonly elementId: string; readonly name: string; readonly value: string | null }
  | { readonly type: "hide"; readonly elementId: string; readonly hidden: boolean }
  | { readonly type: "image"; readonly elementId: string; readonly target: "src" | "background"; readonly file: string };

export type BurstEdit = BurstSourceEdit | { readonly type: "dial"; readonly path: string; readonly value: unknown };

export interface Burst {
  readonly edits: ReadonlyMap<string, BurstSourceEdit>;
  readonly dials: ReadonlyMap<string, unknown>;
}

export const emptyBurst = (): Burst => ({ edits: new Map(), dials: new Map() });

/** The target and field an edit replaces: a later edit with the same key takes its place. */
const burstKey = (edit: BurstSourceEdit): string => {
  const field =
    edit.type === "text" ? "text"
    : edit.type === "style" ? `style:${edit.property}`
    : edit.type === "attribute" ? `attribute:${edit.name}`
    : edit.type === "hide" ? "hidden"
    : `image:${edit.target}`;
  return JSON.stringify([edit.elementId, field]);
};

/** Adds an edit. A source edit replaces the last one for its target and field and keeps its first position; a dial value replaces the held value for its path. */
export function addToBurst(burst: Burst, edit: BurstEdit): Burst {
  if (edit.type === "dial") {
    const dials = new Map(burst.dials);
    dials.set(edit.path, edit.value);
    return { edits: burst.edits, dials };
  }
  const edits = new Map(burst.edits);
  edits.set(burstKey(edit), edit);
  return { edits, dials: burst.dials };
}

/** The burst's source edits, in the order each target and field was first edited. */
export const burstEdits = (burst: Burst): BurstSourceEdit[] => [...burst.edits.values()];

/** The burst's held dial values, by path, in the order each path was first changed. */
export const burstDials = (burst: Burst): Array<{ readonly path: string; readonly value: unknown }> =>
  [...burst.dials].map(([path, value]) => ({ path, value }));
