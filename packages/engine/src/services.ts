import * as Context from "effect/Context";
import type { EngineConfig } from "./config.ts";

/** The process's fixed configuration: install layout, hosting and test variables. */
export class Config extends Context.Service<Config, EngineConfig>()("unframed/engine/Config") {}
