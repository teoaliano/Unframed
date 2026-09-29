import { test as base, type Page, type WebSocket } from "@playwright/test";
import { startEngine, type EngineOptions, type TestEngine } from "../../engine/test/engineProcess.ts";

export const webDist = (): string => {
  const dist = process.env.UNFRAMED_TEST_WEB_DIST;
  if (!dist) throw new Error("The browser seam's global setup did not build the web.");
  return dist;
};

// Provider detection must never find the machine's own Claude or Codex, nor start the
// person's login shell: a test that needs them names fakes in the data folder's `.env`
// (which wins over these) or its own SHELL.
const NO_AGENT_CLI = { CLAUDE_PATH: "/nonexistent/unframed-test/claude", CODEX_PATH: "/nonexistent/unframed-test/codex", SHELL: "/bin/sh" };

/** The key a hosted engine has unless the test gives it a `.env` of its own. */
export const FIXTURE_KEY = "sk-or-v1-test-key-0000abcd";

/**
 * Starts an engine serving the built web, the way the desktop shell hosts it, with the
 * test-only canvas methods on so a test can read what the room holds. Without a `dotenv`
 * it has a key from the process environment, because a keyless app opens the settings
 * dialog over the canvas at first load (spec 10); `.env` stays untouched either way.
 */
export const startHostedEngine = (options: EngineOptions = {}): Promise<TestEngine> =>
  startEngine({
    clientDist: webDist(),
    ...options,
    env: {
      UNFRAMED_TEST_CANVAS: "1",
      ...NO_AGENT_CLI,
      ...(options.dotenv === undefined ? { OPENROUTER_API_KEY: FIXTURE_KEY } : {}),
      ...options.env,
    },
  });

type Fixtures = { engine: TestEngine };

export const test = base.extend<Fixtures>({
  engine: async ({}, use) => {
    const engine = await startHostedEngine();
    await use(engine);
    await engine.dispose();
  },
});

export { expect } from "@playwright/test";

export interface RpcSocketWatch {
  /** Every socket the page opened to `/ws`, in order. */
  readonly sockets: Array<{ socket: WebSocket; openedAt: number; closedAt?: number; frames: any[] }>;
  /** Resolves once socket `index` has received a frame that matches. */
  frame(index: number, predicate: (message: any) => boolean, timeout?: number): Promise<any>;
}

/** Records every `/ws` socket the page opens and every frame it receives. Attach before navigating. */
export const watchRpcSockets = (page: Page): RpcSocketWatch => {
  const sockets: RpcSocketWatch["sockets"] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/ws") return;
    const entry: RpcSocketWatch["sockets"][number] = { socket, openedAt: Date.now(), frames: [] };
    sockets.push(entry);
    socket.on("framereceived", ({ payload }) => {
      try {
        entry.frames.push(JSON.parse(String(payload)));
      } catch {
        // not an RPC frame
      }
    });
    socket.on("close", () => (entry.closedAt = Date.now()));
  });
  return {
    sockets,
    frame: (index, predicate, timeout = 15_000) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const found = sockets[index]?.frames.find(predicate);
          if (found !== undefined) {
            clearInterval(timer);
            resolve(found);
          } else if (Date.now() - started > timeout) {
            clearInterval(timer);
            reject(new Error(`socket ${index} received no matching frame (${sockets.length} sockets)`));
          }
        }, 20);
      }),
  };
};

/** A settings chunk from `settings.subscribe`, optionally with a given text model. */
export const isSettingsChunk =
  (textModel?: string) =>
  (message: any): boolean =>
    message?._tag === "Chunk" &&
    Array.isArray(message.values) &&
    message.values.some((value: any) => typeof value?.hasKey === "boolean" && (textModel === undefined || value.textModel === textModel));
