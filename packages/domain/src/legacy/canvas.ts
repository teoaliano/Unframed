/**
 * The canvas an import makes, described without tldraw (spec 11): every shape by a key
 * that stays the same each time the same old files are mapped. `legacyRecords` turns it
 * into tldraw records.
 */
import type { GroupRecipe, RecipeValue } from "../recipeRules.ts";
import type { LegacyMedium } from "./report.ts";

export type LegacyShapeKind = "prompt" | "image" | "video" | "group" | "page" | "motion";

/** What an image or video shows. `w` and `h` are the natural size its asset records. */
export type LegacyMedia =
  | { readonly kind: "file"; readonly file: string; readonly name: string; readonly mime: string; readonly w: number; readonly h: number }
  | { readonly kind: "link"; readonly url: string; readonly name: string; readonly w: number; readonly h: number }
  /** Only in a converted preset: a file of this name in whichever project it is inserted into. */
  | { readonly kind: "preset-file"; readonly file: string; readonly name: string; readonly mime: string; readonly w: number; readonly h: number }
  /** Only in a converted preset: bytes the insert writes into the project first. */
  | { readonly kind: "data"; readonly url: string; readonly name: string; readonly mime: string; readonly w: number; readonly h: number };

/** Spec 03's approximate result recipe, its sources as shape keys. */
export interface LegacyResultRecipe {
  readonly medium: LegacyMedium;
  readonly model: string;
  readonly params: Readonly<Record<string, RecipeValue>>;
  readonly selectionPrompt: "";
  readonly instruction: "";
  readonly references: readonly [];
  readonly sources: ReadonlyArray<string>;
  readonly approximate: true;
  readonly sentPrompt?: string;
}

/** Spec 03's result meta for an imported result, its sources as shape keys, with its recipe on it. */
export interface LegacyResult {
  readonly sidecar: string | null;
  readonly medium: LegacyMedium;
  readonly model: string;
  readonly batchId: string;
  readonly runIndex: number;
  readonly runCount: number;
  readonly cost: number | null;
  readonly sources: ReadonlyArray<string>;
  readonly recipe: LegacyResultRecipe;
}

/** A render still in flight: spec 04's render placeholder, bound to its job. */
export interface LegacyRender {
  readonly jobId: string;
  readonly startedAt: number;
  readonly params: {
    readonly prompt: string;
    readonly model: string;
    readonly duration: number | null;
    readonly resolution: string | null;
    readonly size: string | null;
  };
}

export interface LegacyShape {
  /** Stable across mappings of the same files: `node:<old id>`, `group:<output id>`, `result:<output id>:<n>` and so on. */
  readonly key: string;
  readonly kind: LegacyShapeKind;
  /** The `@id`: a group's name. */
  readonly ref: string;
  /** Top-left, relative to the parent group when there is one. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The key of the group this shape is a member of. */
  readonly parent?: string;
  readonly text?: string;
  /** A prompt with a fixed width; otherwise it hugs its text. */
  readonly sized?: boolean;
  /** An image's or video's content; absent for an empty one. */
  readonly media?: LegacyMedia;
  readonly artifact?: { readonly file: string; readonly title: string; readonly fileName: string; readonly dials?: Readonly<Record<string, unknown>> };
  /** A group's standing settings. */
  readonly recipe?: GroupRecipe;
  readonly result?: LegacyResult;
  readonly render?: LegacyRender;
}

export interface LegacyCanvas {
  /** In paint order, members after their group. */
  readonly shapes: ReadonlyArray<LegacyShape>;
}
