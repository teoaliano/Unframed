/**
 * The types of the timeline reading (spec 21). Parser-free, so the web imports them from the root
 * entry; the reading itself is in timeline.ts, behind `@unframed/domain/motion`.
 */
import type { Carry } from "./carry.ts";
import type { Owner } from "./owners.ts";

export type PropertyGroup = "position" | "scale" | "size" | "rotation" | "visual" | "other";

const GROUP_KEYS: Readonly<Record<Exclude<PropertyGroup, "other">, readonly string[]>> = {
  position: ["x", "y", "xPercent", "yPercent"],
  scale: ["scale", "scaleX", "scaleY"],
  size: ["width", "height"],
  rotation: ["rotation", "skewX", "skewY"],
  visual: ["opacity", "autoAlpha", "color", "backgroundColor", "borderColor"],
};

export const groupOfKey = (key: string): PropertyGroup => (Object.keys(GROUP_KEYS) as Exclude<PropertyGroup, "other">[]).find((group) => GROUP_KEYS[group].includes(key)) ?? "other";
export type TweenMethod = "to" | "from" | "fromTo" | "set";
/** `number` and `each` space the targets evenly, `amount` spreads a total; `other` is read-only. */
export type StaggerForm = "number" | "each" | "amount" | "other";

export interface TweenRef {
  /** Source order in the timeline script. Value edits do not change it. */
  readonly index: number;
  /** HyperFrames' animation id as the file has it now. */
  readonly id: string;
}

export interface KeyframeValues {
  /** Where the diamond sits, 0 to 1 within the tween. */
  readonly at: number;
  readonly values: Readonly<Record<string, Owner>>;
  readonly ease: Owner | null;
}

export interface Tween {
  readonly ref: TweenRef;
  readonly method: TweenMethod;
  /** `data-hf-id` of each target in document order. */
  readonly targets: readonly string[];
  readonly groups: readonly PropertyGroup[];
  readonly start: Owner;
  readonly duration: Owner;
  readonly ease: Owner | null;
  readonly stagger: Owner | null;
  readonly staggerForm: StaggerForm | null;
  readonly repeat: { readonly count: number | null; readonly yoyo: boolean } | null;
  readonly keyframes: readonly KeyframeValues[];
  readonly readOnly: string | null;
  /** The call as written, cut to 300 characters. */
  readonly source: string;
}

/** A timed element of the root. Its carry is what a move or stretch takes with it (carry.ts). */
export interface Clip {
  readonly hfId: string;
  /** The element's id attribute, or its data-hf-id when it has none. */
  readonly id: string;
  readonly track: number;
  readonly start: Owner;
  readonly duration: Owner;
  readonly carry: Carry;
}

/** One element of the composition: its layer name, its parent element and its nearest clip. */
export interface ElementInfo {
  readonly name: string;
  readonly parent: string | null;
  /** The nearest clip the element is in, itself included. */
  readonly clip: string | null;
}

export interface MotionTimeline {
  readonly file: string;
  readonly script: "ok" | "none" | "unreadable";
  /** The root's data-duration: the motion's length. */
  readonly length: Owner;
  readonly clips: readonly Clip[];
  readonly tweens: readonly Tween[];
  readonly elements: Readonly<Record<string, ElementInfo>>;
  /** The root element's data-hf-id, or null when the file has no root. */
  readonly root: string | null;
}

/** The runtime's own start and duration for a clip, by the clip's element id (the `timeline` message). */
export type RuntimeClips = Readonly<Record<string, { readonly start: number; readonly duration: number }>>;

export interface MotionTimelineOptions {
  readonly file?: string;
  readonly runtime?: RuntimeClips;
}
