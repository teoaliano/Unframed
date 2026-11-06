import type { ChainRef, NodeRef } from "./generation.ts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";
import { PageBox, RecipeAction, RunStarted, type ResultRecipe } from "./generation.ts";
import { Settings } from "./settings.ts";

export const AudioModelParams = Schema.Struct({
  canUseStyle: Schema.Boolean,
  canUseSpeakerBoost: Schema.Boolean,
  languages: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  maxCharacters: Schema.NullOr(Schema.Number),
});
export type AudioModelParams = typeof AudioModelParams.Type;

export const Voice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: Schema.NullOr(Schema.String),
  labels: Schema.Record(Schema.String, Schema.String),
  previewUrl: Schema.NullOr(Schema.String),
});
export type Voice = typeof Voice.Type;

export const VoicesListRequest = Schema.Struct({ search: Schema.optionalKey(Schema.String), pageToken: Schema.optionalKey(Schema.String) });
export const VoicesListAnswer = Schema.Struct({ voices: Schema.Array(Voice), nextPageToken: Schema.NullOr(Schema.String) });
export type VoicesListAnswer = typeof VoicesListAnswer.Type;

export const AudioRunParams = Schema.Struct({
  stability: Schema.optionalKey(Schema.Number),
  similarity_boost: Schema.optionalKey(Schema.Number),
  style: Schema.optionalKey(Schema.Number),
  use_speaker_boost: Schema.optionalKey(Schema.Boolean),
  speed: Schema.optionalKey(Schema.Number),
  output_format: Schema.optionalKey(Schema.String),
  seed: Schema.optionalKey(Schema.Number),
  language_code: Schema.optionalKey(Schema.String),
});
export type AudioRunParams = typeof AudioRunParams.Type;

export const AudioRunRequest = Schema.Struct({
  project: Schema.String,
  model: Schema.optionalKey(Schema.String),
  voice: Schema.Struct({ id: Schema.String, name: Schema.String }),
  params: AudioRunParams,
  selectionPrompt: Schema.String,
  instruction: Schema.String,
  prompt: Schema.String,
  sources: Schema.Array(Schema.String),
  anchor: PageBox,
  of: Schema.optionalKey(Schema.Struct({ shapeId: Schema.String, action: RecipeAction })),
});
export type AudioRunRequest = typeof AudioRunRequest.Type;

export const ElevenLabsStatus = Schema.Union([
  Schema.Struct({ hasKey: Schema.Literal(false) }),
  Schema.Struct({ hasKey: Schema.Literal(true), revoked: Schema.Literal(true) }),
  Schema.Struct({ hasKey: Schema.Literal(true), usageHidden: Schema.Literal(true) }),
  Schema.Struct({
    hasKey: Schema.Literal(true),
    tier: Schema.NullOr(Schema.String),
    creditsUsed: Schema.Number,
    creditLimit: Schema.NullOr(Schema.Number),
    resetsAt: Schema.NullOr(Schema.String),
  }),
]);
export type ElevenLabsStatus = typeof ElevenLabsStatus.Type;

export const VoicesList = Rpc.make("voices.list", { payload: VoicesListRequest, success: VoicesListAnswer, error: UnframedError });

export const RunAudio = Rpc.make("run.audio", { payload: AudioRunRequest, success: RunStarted, error: UnframedError });

export const ElevenLabsStatusRpc = Rpc.make("elevenlabs.status", { success: ElevenLabsStatus, error: UnframedError });

export const SettingsRemoveElevenLabsKey = Rpc.make("settings.removeElevenLabsKey", {
  success: Schema.Struct({ settings: Settings }),
  error: UnframedError,
});

export interface AudioSidecar {
  readonly kind: "audio";
  readonly prompt: string;
  readonly model: string;
  readonly voice: { readonly id: string; readonly name: string };
  readonly voice_settings: Readonly<Record<string, number | boolean>> | null;
  readonly output_format: string;
  readonly seed: number | null;
  readonly language_code: string | null;
  readonly characters: number;
  readonly billing: "elevenlabs-credits";
  readonly credits: number | null;
  readonly requestId: string | null;
  readonly batchId: string;
  readonly runIndex: number;
  readonly runCount: number;
  readonly createdAt: string;
  readonly file: string;
  readonly recipe: ResultRecipe;  readonly node?: NodeRef;
  readonly chain?: ChainRef;
}
