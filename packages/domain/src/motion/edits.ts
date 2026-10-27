/**
 * Motion edits (spec 21): the changes a person makes on the timeline, applied to a motion file
 * with HyperFrames' own writer. Each edit names its tween by `TweenRef` (source order), is
 * checked against the file's own reading (owner, lock, id), and writes only the bytes it changes.
 * Spec 18's `applySourceEdits` gathers these with its other edit types.
 */
import { findTimelineScript, parseGsapScriptAcornForWrite } from "@hyperframes/parsers/gsap-parser-acorn";
import { resizeKeyframedTweenInScript, updateAnimationInScript } from "@hyperframes/parsers/gsap-writer-acorn";
import { EASE_CATALOGUE } from "./eases.ts";
import { motionTimeline, type MotionTimeline, type Tween, type TweenRef } from "./timeline.ts";

export type MotionEdit =
  | { readonly type: "tween-time"; readonly tween: TweenRef; readonly start?: number; readonly duration?: number }
  | { readonly type: "tween-ease"; readonly tween: TweenRef; readonly ease: string | { readonly token: string } }
  | { readonly type: "tween-stagger"; readonly tween: TweenRef; readonly each: number };

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
        : applyTweenStagger(session, edit, base, options);
    if (refusal) return refusal;
  }
  return { ok: true, html: session.html, summary: session.summary };
}

