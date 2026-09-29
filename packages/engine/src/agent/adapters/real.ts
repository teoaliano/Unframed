import type { AgentProvider } from "@unframed/domain";
import type { AdapterContext, ProviderAdapter } from "../adapter.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";

/** The adapter a chat's provider runs on: Claude through the Agent SDK, Codex through `codex app-server`. */
export const realAdapter = (provider: AgentProvider, context: AdapterContext): ProviderAdapter =>
  provider === "codex" ? codexAdapter(context) : claudeAdapter(context);
