import type { SourceEdit } from "@unframed/contracts";


export type BurstEdit = SourceEdit | { readonly type: "dial"; readonly path: string; readonly value: unknown };

export interface Burst {
  readonly edits: ReadonlyMap<string, SourceEdit>;
  readonly dials: ReadonlyMap<string, unknown>;
}

export const emptyBurst = (): Burst => ({ edits: new Map(), dials: new Map() });

const burstKey = (edit: SourceEdit): string => {
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

export const burstEdits = (burst: Burst): SourceEdit[] => [...burst.edits.values()];

export const burstDials = (burst: Burst): Array<{ readonly path: string; readonly value: unknown }> =>
  [...burst.dials].map(([path, value]) => ({ path, value }));

export const dialAt = (dials: Readonly<Record<string, unknown>>, path: string): unknown => {
  let at: unknown = dials;
  for (const key of path.split(".")) {
    if (typeof at !== "object" || at === null || Array.isArray(at)) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
};

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

export const withoutEdit = (burst: Burst, edit: SourceEdit): Burst => ({
  edits: new Map([...burst.edits].filter(([, kept]) => kept !== edit)),
  dials: burst.dials,
});

export const releaseDials = (burst: Burst, values: Readonly<Record<string, unknown>>): Burst => {
  const dials = new Map([...burst.dials].filter(([path, held]) => dialAt(values, path) === held));
  return { edits: burst.edits, dials };
};
