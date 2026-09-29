/** Spec 10: the OpenRouter key flow, key removal and the project lifecycle methods. */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";
import { Settings } from "./settings.ts";

/** What OpenRouter says about the saved key. Nothing else it answers reaches the web. */
export const KeyStatus = Schema.Union([
  Schema.Struct({ hasKey: Schema.Literal(false) }),
  Schema.Struct({ hasKey: Schema.Literal(true), revoked: Schema.Literal(true) }),
  Schema.Struct({
    hasKey: Schema.Literal(true),
    usage: Schema.Number,
    limit: Schema.NullOr(Schema.Number),
    limitRemaining: Schema.NullOr(Schema.Number),
    expiresAt: Schema.NullOr(Schema.String),
    isFreeTier: Schema.Boolean,
  }),
]);
export type KeyStatus = typeof KeyStatus.Type;

export const OAuthPendingAnswer = Schema.Struct({
  state: Schema.Literals(["none", "waiting", "done", "failed"]),
  /** `''` unless failed. */
  reason: Schema.String,
});
export type OAuthPendingAnswer = typeof OAuthPendingAnswer.Type;

/** Deletes the key line; fails every pending render job, reporting a store it could not read instead of failing. */
export const SettingsRemoveKey = Rpc.make("settings.removeKey", {
  success: Schema.Struct({ settings: Settings, endedRenders: Schema.Number, renderCleanupError: Schema.optionalKey(Schema.String) }),
  error: UnframedError,
});

/** Starts the one live connection attempt, replacing any other. Never fails. */
export const OAuthStart = Rpc.make("oauth.start", {
  success: Schema.Struct({ authorizeUrl: Schema.String }),
  error: UnframedError,
});

export const OAuthPending = Rpc.make("oauth.pending", {
  success: OAuthPendingAnswer,
  error: UnframedError,
});

export const OAuthCancel = Rpc.make("oauth.cancel", {
  success: Schema.Struct({}),
  error: UnframedError,
});

export const OAuthStatus = Rpc.make("oauth.status", {
  success: KeyStatus,
  error: UnframedError,
});

export const ProjectsRename = Rpc.make("projects.rename", {
  payload: Schema.Struct({ name: Schema.String, to: Schema.String }),
  success: Schema.Struct({ name: Schema.String, movedRenders: Schema.Number }),
  error: UnframedError,
});

/** Refuses with `conflict` and `details.pendingRenders` while renders are in progress, unless `confirmRenders`. */
export const ProjectsDelete = Rpc.make("projects.delete", {
  payload: Schema.Struct({ name: Schema.String, confirmRenders: Schema.optionalKey(Schema.Boolean) }),
  success: Schema.Struct({ endedRenders: Schema.Number }),
  error: UnframedError,
});
