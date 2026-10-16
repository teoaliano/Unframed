import * as Schema from "effect/Schema";
import { SpendLimit } from "./spend.ts";

/** The client a connection was made for. Spec 14, "Connections and tokens". */
export const ConnectionClient = Schema.Literals(["claude-code", "codex", "claude-desktop", "other"]);
export type ConnectionClient = typeof ConnectionClient.Type;

/** A connection as the Settings dialog shows it. Never a token or a hash. */
export const AgentConnection = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  client: ConnectionClient,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  /** The limit on paid generations, or `null` for none (spec 14). */
  spendLimit: Schema.NullOr(SpendLimit),
  /** Spent in the limit's period, or in total when there is no limit. */
  spent: Schema.Number,
});
export type AgentConnection = typeof AgentConnection.Type;

/** One step of a setup: its text, and the code the person copies, with the language to highlight it as. */
export const SetupStep = Schema.Struct({
  text: Schema.String,
  code: Schema.optional(Schema.String),
  language: Schema.optional(Schema.Literals(["sh", "toml", "json"])),
});
export type SetupStep = typeof SetupStep.Type;

export const AgentConnectionsListAnswer = Schema.Struct({ connections: Schema.Array(AgentConnection) });

export const AgentConnectionsCreate = Schema.Struct({
  name: Schema.String,
  client: ConnectionClient,
  spendLimit: Schema.optionalKey(SpendLimit),
});

export const AgentConnectionsSetSpendLimit = Schema.Struct({ id: Schema.String, spendLimit: Schema.NullOr(SpendLimit) });

export const AgentConnectionsCreateAnswer = Schema.Struct({
  connection: AgentConnection,
  token: Schema.String,
  setup: Schema.Array(SetupStep),
});

export const AgentConnectionsRevoke = Schema.Struct({ id: Schema.String });
