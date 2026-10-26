import { OUTSIDE_SERVER_NAME } from "../outside/connectionSetup.ts";

/**
 * In-app sessions must not load the outside connection's server. A user-scope `unframed-app`
 * entry would reach every in-app session through the person's own settings, and its writes
 * would land in the outside chat.
 */

/** The Claude tools of the outside server, all denied to in-app sessions in every runtime mode. */
export const inAppClaudeDisallowedTools = (): string[] => [`mcp__${OUTSIDE_SERVER_NAME}`];

/** The Codex launch arguments that switch the outside server off for an in-app session. */
export const inAppCodexOutsideOffArgs = (): string[] => ["-c", `mcp_servers.${OUTSIDE_SERVER_NAME}.enabled=false`];
