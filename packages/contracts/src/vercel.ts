import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { UnframedError } from "./errors.ts";
import { Settings } from "./settings.ts";

export const VercelStatus = Schema.Union([
  Schema.Struct({ hasKey: Schema.Literal(false) }),
  Schema.Struct({ hasKey: Schema.Literal(true), revoked: Schema.Literal(true) }),
  Schema.Struct({ hasKey: Schema.Literal(true), balance: Schema.Number, totalUsed: Schema.Number }),
]);
export type VercelStatus = typeof VercelStatus.Type;

export const VercelStatusRpc = Rpc.make("vercel.status", { success: VercelStatus, error: UnframedError });

export const SettingsRemoveVercelKey = Rpc.make("settings.removeVercelKey", {
  success: Schema.Struct({ settings: Settings }),
  error: UnframedError,
});
