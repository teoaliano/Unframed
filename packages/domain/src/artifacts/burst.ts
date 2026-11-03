import type { SourceEdit } from "@unframed/contracts";

/**
 * Edit bursts (spec 18): the edits the editor collects before it writes them as one version. An
 * edit is keyed by its target and field, so a later edit of the same field replaces the earlier
 * one; a style rule (spec 19's StyleRuleRef) is a target too. Dial values are held by path and
 * written with the burst's file in one step.
 */

export type BurstEdit = SourceEdit | { readonly type: "dial"; readonly path: string; readonly value: unknown };

export interface Burst {
  readonly edits: ReadonlyMap<string, SourceEdit>;
  readonly dials: ReadonlyMap<string, unknown>;
}

export const emptyBurst = (): Burst => ({ edits: new Map(), dials: new Map() });

/** The target and field an edit replaces: a later edit with the same key takes its place. */
const burstKey = (edit: SourceEdit): string => {
  // Motion edits (spec 21): a tween is keyed by its source order, a clip by its element id, the length by the root.
  // One timing entry per tween: a start, a duration or both replace the tween's earlier timing (spec 21, Motion edits).
  if (edit.type === "tween-time") return JSON.stringify([`tween:${edit.tween.index}`, "time"]);
  if (edit.type === "tween-ease") return JSON.stringify([`tween:${edit.tween.index}`, "ease"]);
  if (edit.type === "tween-stagger") return JSON.stringify([`tween:${edit.tween.index}`, "stagger"]);
  if (edit.type === "tween-value") return JSON.stringify([`tween:${edit.tween.index}`, `value:${edit.at}:${edit.property}`]);
  if (edit.type === "clip-time") return JSON.stringify([`clip:${edit.clip}`, edit.start !== undefined ? "start" : "duration"]);
  if (edit.type === "composition-duration") return JSON.stringify(["root", "duration"]);
  if (edit.type === "token" && edit.rule !== undefined) {
    return JSON.stringify(["rule", edit.rule.block, edit.rule.selector, edit.rule.occurrence, `style:${edit.property}`]);
  }
  if (edit.type === "componentRule") return JSON.stringify(["rule", edit.rule.block, edit.rule.selector, edit.rule.occurrence, `style:${edit.property}`]);
  if (edit.type === "componentUpdate") return JSON.stringify(["component", edit.tag]);
  const field =
    edit.type === "text" ? "text"
    : edit.type === "style" || edit.type === "token" ? `style:${edit.property}`
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
export const burstEdits = (burst: Burst): SourceEdit[] => [...burst.edits.values()];

/** The burst's held dial values, by path, in the order each path was first changed. */
export const burstDials = (burst: Burst): Array<{ readonly path: string; readonly value: unknown }> =>
  [...burst.dials].map(([path, value]) => ({ path, value }));

/** The value at a dotted dial path (`folder.key`) in nested dial values, or undefined when there is none. */
export const dialAt = (dials: Readonly<Record<string, unknown>>, path: string): unknown => {
  let at: unknown = dials;
  for (const key of path.split(".")) {
    if (typeof at !== "object" || at === null || Array.isArray(at)) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
};

/** The saved dial values with the held values written over them at their paths, nested by folder. Saved values are returned as given when nothing is held. */
export const dialsWith = (saved: Readonly<Record<string, unknown>> | undefined, held: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined => {
  const paths = Object.keys(held);
  if (paths.length === 0) return saved;
  const next: Record<string, unknown> = JSON.parse(JSON.stringify(saved ?? {}));
  for (const path of paths) {
    const keys = path.split(".");
    const last = keys.pop()!;
    let folder = next;
    for (const key of keys) {
      if (typeof folder[key] !== "object" || folder[key] === null) folder[key] = {};
      folder = folder[key] as Record<string, unknown>;
    }
    folder[last] = held[path];
  }
  return next;
};

/** The burst without one source edit (the one the frame refused, for example). Other edits keep their places. */
export const withoutEdit = (burst: Burst, edit: SourceEdit): Burst => ({
  edits: new Map([...burst.edits].filter(([, kept]) => kept !== edit)),
  dials: burst.dials,
});

/** The burst without the held dials the Parameters tab has moved: a path whose value in `values` differs from the held one. */
export const releaseDials = (burst: Burst, values: Readonly<Record<string, unknown>>): Burst => {
  const dials = new Map([...burst.dials].filter(([path, held]) => dialAt(values, path) === held));
  return { edits: burst.edits, dials };
};
