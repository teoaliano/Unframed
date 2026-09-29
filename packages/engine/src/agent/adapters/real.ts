import type { AgentProvider } from "@unframed/domain";
import type { AdapterContext, ProviderAdapter } from "../adapter.ts";

/** The adapter a chat's provider runs on: Claude through the Agent SDK, Codex through `codex app-server`. */
export const realAdapter = (provider: AgentProvider, _context: AdapterContext): ProviderAdapter => {
  throw new Error(`The ${provider} adapter is not available yet.`);
};
