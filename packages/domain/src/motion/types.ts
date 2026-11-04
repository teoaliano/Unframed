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
export type StaggerForm = "number" | "each" | "amount" | "other";

export interface TweenRef {
  readonly index: number;
  readonly id: string;
}

export interface KeyframeValues {
  readonly at: number;
  readonly values: Readonly<Record<string, Owner>>;
  readonly ease: Owner | null;
}

export interface Tween {
  readonly ref: TweenRef;
  readonly method: TweenMethod;
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
  readonly source: string;
}

export interface Clip {
  readonly hfId: string;
  readonly id: string;
  readonly track: number;
  readonly start: Owner;
  readonly duration: Owner;
  readonly carry: Carry;
}

export interface ElementInfo {
  readonly name: string;
  readonly parent: string | null;
  readonly clip: string | null;
}

export interface MotionTimeline {
  readonly file: string;
  readonly script: "ok" | "none" | "unreadable";
  readonly length: Owner;
  readonly clips: readonly Clip[];
  readonly tweens: readonly Tween[];
  readonly elements: Readonly<Record<string, ElementInfo>>;
  readonly root: string | null;
}

export type RuntimeClips = Readonly<Record<string, { readonly start: number; readonly duration: number }>>;

export interface MotionTimelineOptions {
  readonly file?: string;
  readonly runtime?: RuntimeClips;
}
