/**
 * Motion edits (spec 21): the changes a person makes on the timeline, applied to a motion file
 * with HyperFrames' own writer. Each edit names its tween by `TweenRef` (source order), is
 * checked against the file's own reading (owner, lock, id), and writes only the bytes it changes.
 * Spec 18's `applySourceEdits` gathers these with its other edit types.
 */
import { findTimelineScript, parseGsapScriptAcornForWrite } from "@hyperframes/parsers/gsap-parser-acorn";
import { resizeKeyframedTweenInScript, updateAnimationInScript, updateKeyframeInScript } from "@hyperframes/parsers/gsap-writer-acorn";
import { EASE_CATALOGUE } from "./eases.ts";
import type { ScriptNode } from "./owners.ts";
import { motionTimeline, type MotionTimeline, type Tween, type TweenRef } from "./timeline.ts";
import { NAMED_COLOURS } from "./colours.ts";

export type MotionEdit =
  | { readonly type: "tween-time"; readonly tween: TweenRef; readonly start?: number; readonly duration?: number }
  | { readonly type: "tween-ease"; readonly tween: TweenRef; readonly ease: string | { readonly token: string } }
  | { readonly type: "tween-stagger"; readonly tween: TweenRef; readonly each: number }
  | { readonly type: "tween-value"; readonly tween: TweenRef; readonly at: number; readonly property: string; readonly value: number | string | { readonly token: string } };

export interface MotionEditOptions {
  /** `data-hf-id`s of the elements the person locked in Layers. Descendants of one are locked too. */
  readonly lockedElements?: ReadonlySet<string>;
  /** The kind of a token in the project's kit (`easing`, `colour`, `number`, `duration`), or undefined. */
  readonly tokenKind?: (name: string) => string | undefined;
}

export type MotionEditResult = { readonly ok: true; readonly html: string; readonly summary: string[] } | { readonly ok: false; readonly refusal: string };

const MIN_DURATION = 0.033;
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** Milliseconds, as the writer keeps them. */
const millis = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/** The timeline script's text and where it sits in the file, found the way the reading finds it. */
interface ScriptSpan { readonly textContent: string; readonly start: number; readonly end: number }

const timelineSpan = (html: string): ScriptSpan | null => {
  const inline: ScriptSpan[] = [];
  for (const match of html.matchAll(SCRIPT)) {
    if (/\bsrc\s*=/i.test(match[1]!)) continue;
    const start = match.index! + match[0].indexOf(">") + 1;
    inline.push({ textContent: match[2]!, start, end: start + match[2]!.length });
  }
  return findTimelineScript(inline) as ScriptSpan | null;
};

const splice = (html: string, span: ScriptSpan, text: string): string => html.slice(0, span.start) + text + html.slice(span.end);

/** Names an element for a sentence: its layer name, as the reading gives it. */
const nameOf = (reading: MotionTimeline, hfId: string | undefined): string => (hfId ? reading.elements[hfId]?.name ?? hfId : "the tween");

/** The first locked element among a tween's targets, or one of their ancestors. */
const lockedAmong = (reading: MotionTimeline, tween: Tween, locked: ReadonlySet<string> | undefined): string | null => {
  if (!locked || locked.size === 0) return null;
  for (const target of tween.targets) {
    let current: string | null | undefined = target;
    while (current) {
      if (locked.has(current)) return current;
      current = reading.elements[current]?.parent ?? null;
    }
  }
  return null;
};

const lockSentence = (name: string) => `${name} is locked. Unlock it in Layers to edit it.`;

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Session {
  html: string;
  /** The HyperFrames id of each tween as the file has it now, by index. Moves change them. */
  ids: string[];
  summary: string[];
}

const applyTweenTime = (session: Session, edit: Extract<MotionEdit, { type: "tween-time" }>, base: MotionTimeline, options: MotionEditOptions): MotionEditResult | null => {
  const index = edit.tween.index;
  const tween = base.tweens[index];
  if (!tween || tween.ref.id !== edit.tween.id) return refuse(`The tween on ${nameOf(base, tween?.targets[0])} changed since this edit began.`);
  const name = nameOf(base, tween.targets[0]);
  const field = edit.start !== undefined ? "start" : "duration";
  if (tween.readOnly !== null) return refuse(`${name}'s ${field} is set by the agent's code.`);
  const locked = lockedAmong(base, tween, options.lockedElements);
  if (locked !== null) return refuse(lockSentence(nameOf(base, locked)));
  if (edit.start !== undefined && tween.start.kind !== "source") return refuse(`${name}'s start is set by the agent's code.`);
  if (edit.duration !== undefined) {
    if (tween.method === "set") return refuse("A set has no duration to change.");
    if (tween.duration.kind !== "source") return refuse(`${name}'s duration is set by the agent's code.`);
  }

  const span = timelineSpan(session.html);
  const text = span?.textContent ?? "";
  const parsed = parseGsapScriptAcornForWrite(text);
  const entry = parsed?.located[index];
  if (!span || !parsed || !entry || entry.id !== session.ids[index]) return refuse(`The tween on ${name} changed since this edit began.`);

  const position = edit.start !== undefined ? millis(Math.max(0, edit.start)) : undefined;
  const duration = edit.duration !== undefined ? millis(Math.max(MIN_DURATION, edit.duration)) : undefined;
  let next: string;
  if (entry.animation.keyframes) {
    const currentPosition = typeof entry.animation.position === "number" ? entry.animation.position : 0;
    const currentDuration = entry.animation.duration ?? (tween.duration.kind === "source" && typeof tween.duration.value === "number" ? tween.duration.value : 0.5);
    const remap = entry.animation.keyframes.keyframes.map((key) => ({ from: key.percentage, to: key.percentage }));
    next = resizeKeyframedTweenInScript(text, entry.id, position ?? currentPosition, duration ?? currentDuration, remap);
  } else {
    next = updateAnimationInScript(text, entry.id, { ...(position !== undefined ? { position } : {}), ...(duration !== undefined ? { duration } : {}) });
  }
  if (next === text) return refuse(`The edit to ${name} could not be applied.`);

  const reparsed = parseGsapScriptAcornForWrite(next);
  const movedId = reparsed?.located[index]?.id;
  if (movedId === undefined) return refuse(`The edit to ${name} could not be applied.`);
  const group = tween.groups[0] ?? "position";
  const lines: string[] = [];
  if (position !== undefined) lines.push(`Moved ${name} ${group} to ${position} s`);
  if (duration !== undefined) lines.push(`Set ${name} ${group} to ${duration} s long`);
  session.html = splice(session.html, span, next);
  session.ids[index] = movedId;
  session.summary.push(...lines.map(sentenceCase));
  return null;
};

const refuse = (refusal: string): MotionEditResult => ({ ok: false, refusal });

const applyTweenValue = (session: Session, edit: Extract<MotionEdit, { type: "tween-value" }>, base: MotionTimeline, options: MotionEditOptions): MotionEditResult | null => {
  const found = locate(session, edit, base);
  if ("refusal" in found) return found.refusal;
  const { tween, name, span, text, entry, index } = found;
  const diamond = tween.keyframes.find((k) => k.at === edit.at);
  if (!diamond) return refuse(`${name} has no ${edit.at === 0 ? "start" : "end"} value to set.`);
  const owner = diamond.values[edit.property];
  if (!owner) return refuse(`${name} has no ${edit.property} at this diamond.`);
  if (owner.kind !== "source" && owner.kind !== "token") return refuse(`${name}'s ${edit.property} is set by the agent's code.`);
  const locked = lockedAmong(base, tween, options.lockedElements);
  if (locked !== null) return refuse(lockSentence(nameOf(base, locked)));
  const current = owner.kind === "source" ? owner.value : undefined;
  const resolved = valueFor(edit, current, name, options.tokenKind);
  if ("refusal" in resolved) return refuse(resolved.refusal);

  const parsed = parseGsapScriptAcornForWrite(text)!;
  const call = parsed.located[index]!;
  const { node, keyframe } = diamondNode(call.call as never, call.animation, edit.at);
  if (!node) return refuse(`${name} has no ${edit.property} at this diamond.`);
  const raws: [string, string][] = [];
  const props: Record<string, number | string> = {};
  for (const property of propertiesOf(node)) {
    const key = keyOfNode(property);
    if (key === null) continue;
    if (key === edit.property) {
      props[key] = typeof resolved.text === "object" ? "__unframed_token__" : resolved.text;
      continue;
    }
    const placeholder = `__unframed_raw_${raws.length}__`;
    raws.push([placeholder, text.slice(property.value.start, property.value.end)]);
    props[key] = placeholder;
  }
  let next: string;
  if (keyframe !== null) next = updateKeyframeInScript(text, entry.id, keyframe, props);
  else if (node === call.call.fromArg) next = updateAnimationInScript(text, entry.id, { fromProperties: props });
  else next = updateAnimationInScript(text, entry.id, { properties: props });
  if (typeof resolved.text === "object") next = next.replace('"__unframed_token__"', `unframed.token(${JSON.stringify(resolved.text.token)})`);
  for (const [placeholder, raw] of raws) next = next.replace(`"${placeholder}"`, raw);
  if (next === text) return refuse(`The edit to ${name} could not be applied.`);
  const movedId = parseGsapScriptAcornForWrite(next)?.located[index]?.id;
  if (movedId === undefined) return refuse(`The edit to ${name} could not be applied.`);
  session.html = splice(session.html, span, next);
  session.ids[index] = movedId;
  const shown = typeof edit.value === "object" ? `the ${edit.value.token} token` : String(edit.value);
  session.summary.push(`Set ${name} ${edit.property} to ${typeof resolved.text === "number" || typeof resolved.text === "string" ? resolved.text : shown}`);
  return null;
};

const COLOUR_FORMS = [/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i, /^rgba?\(.+\)$/i, /^hsla?\(.+\)$/i, /^oklch\(.+\)$/i];
const NUMBER_TEXT = /^-?\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh|deg|s|ms)?$/i;

const isColourText = (text: string): boolean => COLOUR_FORMS.some((form) => form.test(text.trim())) || NAMED_COLOURS.has(text.trim().toLowerCase());
const isNumberText = (text: string): boolean => NUMBER_TEXT.test(text.trim());

/** A number takes the unit of the literal it replaces: `"120px"` stays in px. Null when the literal has no number. */
const unitOf = (current: number | string): string | null => {
  if (typeof current === "number") return "";
  const match = /^-?\d+(?:\.\d+)?([a-z%]*)$/i.exec(current.trim());
  return match ? match[1]! : null;
};

/** The value a tween-value writes, or the refusal sentence when the value does not fit the literal. */
const valueFor = (edit: Extract<MotionEdit, { type: "tween-value" }>, current: number | string | undefined, name: string, tokenKind: MotionEditOptions["tokenKind"]): { text: number | string | { token: string } } | { refusal: string } => {
  const { value, property } = edit;
  if (typeof value === "object") {
    const kind = tokenKind?.(value.token);
    const numeric = typeof current === "number" || (typeof current === "string" && isNumberText(current));
    if (kind === "colour" && typeof current === "string" && isColourText(current)) return { text: value };
    if ((kind === "number" || kind === "duration") && numeric) return { text: value };
    return { refusal: `${value.token} is not a token of a matching type.` };
  }
  if (typeof value === "number") {
    const unit = current === undefined ? "" : unitOf(current);
    if (unit === null) return { refusal: `${name}'s ${property} takes a colour, not a number.` };
    return { text: unit === "" ? value : `${value}${unit}` };
  }
  if (isColourText(value) || isNumberText(value)) return { text: value };
  return { refusal: `${value} is not a colour or a number.` };
};

const keyOfNode = (property: ScriptNode): string | null => {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
};

/** The object literal that holds a diamond's values in the call, as the writer's parse has it. */
const diamondNode = (call: { varsArg?: unknown; fromArg?: unknown; method: string }, animation: { keyframes?: unknown }, at: number): { node: ScriptNode | undefined; keyframe: number | null } => {
  if (animation.keyframes) {
    const keyframes = propertiesOf(call.varsArg as ScriptNode).find((p) => keyOfNode(p) === "keyframes")?.value as ScriptNode | undefined;
    const step = propertiesOf(keyframes).find((p) => {
      const pct = /^(\d+(?:\.\d+)?)%$/.exec(keyOfNode(p) ?? "");
      return pct !== null && Number(pct[1]) / 100 === at;
    });
    return { node: step?.value as ScriptNode | undefined, keyframe: at * 100 };
  }
  if (at === 0 && call.method === "fromTo") return { node: call.fromArg as ScriptNode | undefined, keyframe: null };
  return { node: call.varsArg as ScriptNode | undefined, keyframe: null };
};

const propertiesOf = (node: ScriptNode | undefined): ScriptNode[] => (node?.type === "ObjectExpression" ? node.properties.filter((p: ScriptNode) => p.type === "Property") : []);

/** Stands in for a token expression while the writer runs; the writer quotes it like any string. */
const tokenPlaceholder = (index: number) => `__unframed_token_${index}__`;

/** Checks that an edit's tween is the one the base reading read, and returns the live location of it. */
const locate = (session: Session, edit: { readonly tween: TweenRef }, base: MotionTimeline) => {
  const tween = base.tweens[edit.tween.index];
  const name = nameOf(base, tween?.targets[0]);
  if (!tween || tween.ref.id !== edit.tween.id) return { refusal: refuse(`The tween on ${name} changed since this edit began.`) } as const;
  const span = timelineSpan(session.html);
  const text = span?.textContent ?? "";
  const parsed = parseGsapScriptAcornForWrite(text);
  const entry = parsed?.located[edit.tween.index];
  if (!span || !parsed || !entry || entry.id !== session.ids[edit.tween.index]) {
    return { refusal: refuse(`The tween on ${name} changed since this edit began.`) } as const;
  }
  return { tween, name, span, text, entry, index: edit.tween.index } as const;
};

const applyTweenEase = (session: Session, edit: Extract<MotionEdit, { type: "tween-ease" }>, base: MotionTimeline, options: MotionEditOptions): MotionEditResult | null => {
  const found = locate(session, edit, base);
  if ("refusal" in found) return found.refusal;
  const { tween, name, span, text, entry, index } = found;
  const written = tween.ease;
  const token = typeof edit.ease === "object" ? edit.ease.token : null;
  if (written !== null && written.kind !== "source" && written.kind !== "token") return refuse(`${name}'s ease is set by the agent's code.`);
  const locked = lockedAmong(base, tween, options.lockedElements);
  if (locked !== null) return refuse(lockSentence(nameOf(base, locked)));

  if (token !== null) {
    if (options.tokenKind?.(token) !== "easing") return refuse(`${token} is not an easing token of this project's kit.`);
  } else if (typeof edit.ease === "string" && !EASE_CATALOGUE.includes(edit.ease)) {
    const alreadyWritten = written?.kind === "source" && written.value === edit.ease;
    if (!alreadyWritten) return refuse(`${edit.ease} is not an ease the timeline offers.`);
  }
  const label = token !== null ? `the ${token} token` : (edit.ease as string);
  const value = token !== null ? tokenPlaceholder(0) : (edit.ease as string);
  if (token === null && written?.kind === "source" && written.value === value) return { ok: true, html: session.html, summary: [] };

  let next = updateAnimationInScript(text, entry.id, { ease: value });
  if (token !== null) next = next.replace(`"${tokenPlaceholder(0)}"`, `unframed.token(${JSON.stringify(token)})`);
  if (next === text) return refuse(`The edit to ${name} could not be applied.`);
  const movedId = parseGsapScriptAcornForWrite(next)?.located[index]?.id;
  if (movedId === undefined) return refuse(`The edit to ${name} could not be applied.`);
  session.html = splice(session.html, span, next);
  session.ids[index] = movedId;
  session.summary.push(`Eased ${name} ${tween.groups[0] ?? "position"} with ${label}`);
  return null;
};

const applyTweenStagger = (session: Session, edit: Extract<MotionEdit, { type: "tween-stagger" }>, base: MotionTimeline, options: MotionEditOptions): MotionEditResult | null => {
  const found = locate(session, edit, base);
  if ("refusal" in found) return found.refusal;
  const { tween, name, span, text, entry, index } = found;
  if (tween.readOnly !== null) return refuse(`${name}'s stagger is set by the agent's code.`);
  if (tween.stagger === null) return refuse(`${name} has no stagger to space.`);
  if (tween.stagger.kind !== "source" || tween.staggerForm === "other" || tween.staggerForm === null) return refuse(`${name}'s stagger is set by the agent's code.`);
  const locked = lockedAmong(base, tween, options.lockedElements);
  if (locked !== null) return refuse(lockSentence(nameOf(base, locked)));

  const each = millis(Math.max(0, edit.each));
  const count = tween.targets.length;
  const stagger = tween.staggerForm === "amount" ? millis(each * Math.max(0, count - 1)) : each;
  const value = tween.staggerForm === "number" ? each : tween.staggerForm === "each" ? { each } : { amount: stagger };
  const next = updateAnimationInScript(text, entry.id, { extras: { stagger: value } });
  if (next === text) return refuse(`The edit to ${name} could not be applied.`);
  const movedId = parseGsapScriptAcornForWrite(next)?.located[index]?.id;
  if (movedId === undefined) return refuse(`The edit to ${name} could not be applied.`);
  session.html = splice(session.html, span, next);
  session.ids[index] = movedId;
  session.summary.push(`Spaced the ${name} stagger ${each} s apart`);
  return null;
};

/** Applies edits in order to one motion file. Nothing is written unless every edit applies. */
export function applyMotionEdits(html: string, edits: readonly MotionEdit[], options: MotionEditOptions = {}): MotionEditResult {
  const base = motionTimeline(html);
  const session: Session = { html, ids: base.tweens.map((tween) => tween.ref.id), summary: [] };
  for (const edit of edits) {
    const refusal = edit.type === "tween-time"
      ? applyTweenTime(session, edit, base, options)
      : edit.type === "tween-ease"
        ? applyTweenEase(session, edit, base, options)
        : edit.type === "tween-stagger"
          ? applyTweenStagger(session, edit, base, options)
          : applyTweenValue(session, edit, base, options);
    if (refusal) return refusal;
  }
  return { ok: true, html: session.html, summary: session.summary };
}

