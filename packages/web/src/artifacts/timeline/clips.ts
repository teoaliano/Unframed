import type { MotionTimelineReading, SourceEdit } from "@unframed/contracts";
import { numberOf } from "./rows.ts";

export type ClipOf = MotionTimelineReading["clips"][number];
export type TweenOf = MotionTimelineReading["tweens"][number];

export const clipNoteOf = (clip: ClipOf): string | null => {
  if ("refused" in clip.carry) return clip.carry.refused;
  if (clip.start.kind !== "source" || clip.duration.kind !== "source") return "Set by the agent's code.";
  return null;
};

export const carriedTimingOf = (reading: MotionTimelineReading, pending: readonly SourceEdit[], dials: Readonly<Record<string, unknown>>): SourceEdit[] => {
  const drawn: SourceEdit[] = [];
  for (const edit of pending) {
    if (edit.type !== "clip-time") continue;
    const clip = reading.clips.find((candidate) => candidate.hfId === edit.clip);
    if (!clip || !("tweens" in clip.carry)) continue;
    const oldStart = numberOf(clip.start, dials);
    const oldDuration = numberOf(clip.duration, dials);
    if (oldStart === undefined || oldDuration === undefined || oldDuration <= 0) continue;
    const newStart = edit.start ?? oldStart;
    const newDuration = edit.duration ?? oldDuration;
    const scale = newDuration / oldDuration;
    for (const ref of clip.carry.tweens) {
      if (pending.some((other) => other.type === "tween-time" && other.tween.index === ref.index)) continue;
      const tween = reading.tweens.find((candidate) => candidate.ref.index === ref.index);
      if (!tween || tween.start.kind !== "source" || tween.duration.kind !== "source") continue;
      const start = Number(tween.start.value);
      const duration = Number(tween.duration.value);
      drawn.push({
        type: "tween-time",
        tween: ref,
        start: Math.round((newStart + (start - oldStart) * scale) * 1000) / 1000,
        duration: Math.round(duration * scale * 1000) / 1000,
      });
    }
  }
  return drawn;
};

export const carriedDialsOf = (
  reading: MotionTimelineReading,
  clip: ClipOf,
  origin: { start: number; duration: number },
  next: { start: number; duration: number },
  dialsAtPress: Readonly<Record<string, unknown>>,
): Array<{ path: readonly string[]; value: number }> => {
  if (!("tweens" in clip.carry)) return [];
  const scale = origin.duration > 0 ? next.duration / origin.duration : 1;
  const written: Array<{ path: readonly string[]; value: number }> = [];
  for (const ref of clip.carry.tweens) {
    const tween = reading.tweens.find((candidate) => candidate.ref.index === ref.index);
    if (!tween) continue;
    if (tween.start.kind === "dial") {
      const at = numberOf(tween.start, dialsAtPress);
      if (at !== undefined) written.push({ path: tween.start.path, value: next.start + (at - origin.start) * scale });
    }
    if (tween.duration.kind === "dial") {
      const at = numberOf(tween.duration, dialsAtPress);
      if (at !== undefined) written.push({ path: tween.duration.path, value: at * scale });
    }
  }
  return written;
};
