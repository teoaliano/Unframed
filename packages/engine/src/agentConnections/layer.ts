import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Config } from "../services.ts";
import { ConnectionBook } from "./book.ts";

/** The outside connections of this data folder. Engine-wide, per person: it holds no project state. */
export class AgentConnections extends Context.Service<AgentConnections, { readonly book: ConnectionBook }>()("unframed/engine/AgentConnections") {}

export const agentConnectionsLayer = Layer.effect(
  AgentConnections,
  Effect.gen(function* () {
    const config = yield* Config;
    return AgentConnections.of({ book: new ConnectionBook(config.agentConnectionsPath) });
  }),
);
