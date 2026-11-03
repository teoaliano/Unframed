import type { Clip, ElementInfo, Tween, TweenRef } from "./types.ts";
import type { Owner } from "./owners.ts";

export type Carry = { readonly tweens: TweenRef[]; readonly dials: string[][] } | { readonly refused: string };

export interface CarryOptions {
  readonly stretch?: boolean;
}

export interface CarryModel {
  readonly clips: readonly Clip[];
  readonly tweens: readonly Tween[];
  readonly elements: Readonly<Record<string, ElementInfo>>;
}

const dialPath = (owner: Owner | null): string[] | null => (owner?.kind === "dial" ? [...owner.path] : null);

const nameOf = (model: CarryModel, hfId: string): string => model.elements[hfId]?.name ?? hfId;

const carries = (model: CarryModel, clipHfId: string, tween: Tween): boolean =>
  tween.targets.length > 0 && tween.targets.every((target) => model.elements[target]?.clip === clipHfId);

export function carryOf(model: CarryModel, clip: Clip, options: CarryOptions = {}): Carry {
  const carried = model.tweens.filter((tween) => carries(model, clip.hfId, tween));
  const outside = model.tweens.filter((tween) => !carries(model, clip.hfId, tween));

  for (const tween of carried) {
    const timed = tween.start.kind === "script" || (options.stretch === true && tween.duration.kind === "script");
    if (timed) {
      const group = tween.groups[0] ?? "position";
      return { refused: `This clip can't move: the ${group} tween on ${nameOf(model, tween.targets[0]!)} is timed by the agent's code.` };
    }
  }

  const dials = unique(carried.flatMap((tween) => [dialPath(tween.start), dialPath(tween.duration)]).filter(isPath));
  for (const path of dials) {
    const elsewhere = outside.some((tween) => [dialPath(tween.start), dialPath(tween.duration)].some((p) => p !== null && same(p, path)));
    if (elsewhere) return { refused: `This clip can't move: the parameter ${path.join(" › ")} also times a tween outside it.` };
  }

  for (const other of model.clips) {
    if (other.hfId !== clip.hfId && other.start.kind === "script" && other.start.text === clip.id && clip.id !== "") {
      return { refused: `This clip can't move: ${other.id || other.hfId} starts relative to it.` };
    }
  }

  if (clip.start.kind === "script" || clip.duration.kind === "script") return { refused: "Set by the agent's code." };

  return {
    tweens: carried.map((tween) => tween.ref),
    dials,
  };
}

export function carryFor(model: CarryModel, clipHfId: string, options: CarryOptions = {}): Carry {
  const clip = model.clips.find((candidate) => candidate.hfId === clipHfId);
  return clip ? carryOf(model, clip, options) : { tweens: [], dials: [] };
}

const isPath = (path: string[] | null): path is string[] => path !== null;
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((step, i) => step === b[i]);
const unique = (paths: (string[] | null)[]): string[][] => {
  const kept: string[][] = [];
  for (const path of paths) if (path && !kept.some((other) => same(other, path))) kept.push(path);
  return kept;
};
