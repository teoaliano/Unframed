/**
 * The engine seam. Forks the real engine into a temporary data folder on an OS-assigned
 * port, with every OpenRouter call pointed at an in-test stub and native commands
 * recorded instead of run. Tests drive the engine only through what this exposes: RPC,
 * HTTP, IPC messages, stdout and the files it writes.
 */
import { fork, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineIpcMessage, ReadyMessage } from "@unframed/contracts";
import WebSocket from "ws";
import { repoRoot } from "../../../scripts/buildWeb.ts";
import { connectRpc, type TestRpcClient } from "./rpcClient.ts";

export { repoRoot };
export const sourceEntry = join(repoRoot, "packages/engine/src/main.ts");

export interface EngineOptions {
  /** Fork with an IPC channel (default true). */
  ipc?: boolean;
  /** Sets `UNFRAMED_CLIENT_DIST`, the hosted marker. */
  clientDist?: string;
  /** Extra process environment. `undefined` removes a variable the harness would set. */
  env?: Record<string, string | undefined>;
  /** Text written to `<data folder>/.env` before boot. */
  dotenv?: string;
  /** Reuse a data folder, for restarts. A new temporary one otherwise. */
  dataDir?: string;
  /** The entry to fork: the source `main.ts` by default, or a bundle's `server/index.js`. */
  entry?: string;
  /** Extra arguments for the Node process running the entry. */
  execArgv?: string[];
  /** The Node binary to run (defaults to the one running the tests). */
  execPath?: string;
  /** Wait for the banner and the ready message (default true). */
  waitForReady?: boolean;
  /** Point `UNFRAMED_TEST_OPENROUTER_ORIGIN` at a stub (default true). */
  openRouterStub?: boolean;
  /** How the stub answers, from the start. */
  stub?: StubHandler;
}

export interface Exited {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
  json(): any;
}

export interface TestEngine {
  readonly dataDir: string;
  readonly port: number;
  readonly previewPort: number;
  readonly pid: number;
  readonly process: ChildProcess;
  /** The origin a same-machine browser would use. */
  readonly origin: string;
  readonly stub: OpenRouterStub | undefined;
  stdout(): string;
  stderr(): string;
  /** Every IPC message received so far. */
  readonly messages: EngineIpcMessage[];
  readonly exited: Promise<Exited>;
  /** Waits for stdout to contain `text` (or match it). */
  waitForOutput(text: string | RegExp, timeoutMs?: number): Promise<void>;
  waitForMessage(predicate: (message: EngineIpcMessage) => boolean, timeoutMs?: number): Promise<EngineIpcMessage>;
  /** Opens a new RPC socket. Closed when the engine is disposed. */
  rpc(): Promise<TestRpcClient>;
  /** An HTTP request to the API listener, with full control over headers (including Host). */
  request(path: string, options?: RequestOptions): Promise<RawResponse>;
  /** A raw WebSocket to `/ws`. */
  socket(options?: { headers?: Record<string, string>; path?: string; port?: number }): WebSocket;
  /** Every command the engine would have spawned, from `UNFRAMED_TEST_NATIVE_LOG`. */
  nativeLog(): Promise<Array<{ cmd: string; args: string[] }>>;
  /** Sends a signal and waits for the exit. */
  stop(signal?: NodeJS.Signals): Promise<Exited>;
  /** Kills the process if still running, closes clients, and removes a data folder it made. */
  dispose(): Promise<void>;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: string | Buffer;
  port?: number;
}

export const rawRequest = (port: number, path: string, options: RequestOptions = {}): Promise<RawResponse> =>
  new Promise((resolvePromise, reject) => {
    const headers: Record<string, string> = { host: `localhost:${port}` };
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (value === undefined) delete headers[name.toLowerCase()];
      else headers[name.toLowerCase()] = value;
    }
    const req = http.request(
      { host: "127.0.0.1", port, path, method: options.method ?? "GET", headers, setHost: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolvePromise({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            text: body.toString("utf8"),
            json: () => JSON.parse(body.toString("utf8")),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });

/** Answers a stub request itself by returning true; anything else falls through to a 404. */
export type StubHandler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => boolean | void;

export interface OpenRouterStub {
  readonly origin: string;
  readonly requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }>;
  /** Replaces how the stub answers, for the requests that follow. */
  setHandler(handler: StubHandler | undefined): void;
  close(): Promise<void>;
}

/** A loopback server standing in for openrouter.ai. Answers 404 to everything a handler does not answer. */
export const startOpenRouterStub = async (initial?: StubHandler): Promise<OpenRouterStub> => {
  let handler = initial;
  const requests: OpenRouterStub["requests"] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body });
      if (handler?.(req, body, res) === true) return;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "The stub has no route for this." } }));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub has no port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    setHandler: (next) => {
      handler = next;
    },
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
};

let registerCleanup: (cleanup: () => Promise<void>) => void = () => {};

/**
 * How a test runner hears about cleanups: the Vitest harness registers each with the
 * running test. Without one (Playwright, scripts) the caller disposes.
 */
export const setCleanupRegistrar = (registrar: (cleanup: () => Promise<void>) => void): void => {
  registerCleanup = registrar;
};

/** A fresh temporary folder, removed when the test finishes (when a runner registered cleanups). */
export const makeTempDir = async (prefix = "unframed-test-"): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  registerCleanup(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const until = <T>(check: () => T | undefined, describe: () => string, timeoutMs: number, exited?: Promise<Exited>): Promise<T> =>
  new Promise((resolvePromise, reject) => {
    const started = Date.now();
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      fn();
    };
    const tick = () => {
      const value = check();
      if (value !== undefined) finish(() => resolvePromise(value));
      else if (Date.now() - started > timeoutMs) finish(() => reject(new Error(`Timed out: ${describe()}`)));
    };
    const timer = setInterval(tick, 10);
    exited?.then((exit) => {
      setTimeout(() => {
        const value = check();
        if (value !== undefined) finish(() => resolvePromise(value));
        else finish(() => reject(new Error(`Engine exited (${exit.code ?? exit.signal}) before: ${describe()}`)));
      }, 50);
    });
    tick();
  });

export const startEngine = async (options: EngineOptions = {}): Promise<TestEngine> => {
  const ownsDataDir = options.dataDir === undefined;
  const dataDir = options.dataDir ?? (await makeTempDir());
  const nativeLogPath = join(dataDir, ".native-log.jsonl");
  if (options.dotenv !== undefined) await writeFile(join(dataDir, ".env"), options.dotenv);
  const stub = options.openRouterStub === false ? undefined : await startOpenRouterStub(options.stub);

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name.startsWith("UNFRAMED_") || name.startsWith("OPENROUTER_") || name === "OUTPUT_DIR") continue;
    if (name === "PORT" || name === "CLAUDE_PATH" || name === "CODEX_PATH" || name === "CLAUDE_CONFIG_DIR") continue;
    if (name.startsWith("VITEST") || name === "NODE_OPTIONS") continue;
    env[name] = value;
  }
  Object.assign(env, {
    PORT: "0",
    UNFRAMED_DATA_DIR: dataDir,
    UNFRAMED_TEST_NATIVE_LOG: nativeLogPath,
  });
  if (stub) env.UNFRAMED_TEST_OPENROUTER_ORIGIN = stub.origin;
  if (options.clientDist !== undefined) env.UNFRAMED_CLIENT_DIST = options.clientDist;
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }

  const ipc = options.ipc !== false;
  const entry = options.entry ?? sourceEntry;
  const child = ipc
    ? fork(entry, [], {
        env,
        cwd: dataDir,
        execArgv: options.execArgv ?? [],
        ...(options.execPath === undefined ? {} : { execPath: options.execPath }),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        serialization: "json",
      })
    : spawn(options.execPath ?? process.execPath, [...(options.execArgv ?? []), entry], {
        env,
        cwd: dataDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const messages: EngineIpcMessage[] = [];
  child.on("message", (message) => messages.push(message as EngineIpcMessage));
  const exited = new Promise<Exited>((done) => child.on("exit", (code, signal) => done({ code, signal })));
  let hasExited = false;
  void exited.then(() => (hasExited = true));

  const clients = new Set<TestRpcClient>();
  const sockets = new Set<WebSocket>();
  let port = 0;
  let previewPort = 0;

  const waitForOutput = (text: string | RegExp, timeoutMs = 15_000) =>
    until(
      () => ((typeof text === "string" ? stdout.includes(text) : text.test(stdout)) ? true : undefined),
      () => `stdout to contain ${String(text)}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      timeoutMs,
      exited,
    ).then(() => undefined);

  const waitForMessage = (predicate: (message: EngineIpcMessage) => boolean, timeoutMs = 15_000) =>
    until(
      () => messages.find(predicate),
      () => `an IPC message\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      timeoutMs,
      exited,
    );

  const engine: TestEngine = {
    dataDir,
    get port() {
      return port;
    },
    get previewPort() {
      return previewPort;
    },
    pid: child.pid ?? 0,
    process: child,
    get origin() {
      return `http://localhost:${port}`;
    },
    stub,
    stdout: () => stdout,
    stderr: () => stderr,
    messages,
    exited,
    waitForOutput,
    waitForMessage,
    async rpc() {
      const client = await connectRpc(`ws://127.0.0.1:${port}/ws`);
      clients.add(client);
      return client;
    },
    request: (path, requestOptions) => rawRequest(requestOptions?.port ?? port, path, requestOptions),
    socket(socketOptions = {}) {
      const target = socketOptions.port ?? port;
      const socket = new WebSocket(`ws://127.0.0.1:${target}${socketOptions.path ?? "/ws"}`, {
        headers: { host: `localhost:${target}`, ...socketOptions.headers },
      });
      socket.on("error", () => {});
      sockets.add(socket);
      return socket;
    },
    async nativeLog() {
      const text = await readFile(nativeLogPath, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
    },
    async stop(signal = "SIGTERM") {
      if (!hasExited) child.kill(signal);
      return exited;
    },
    async dispose() {
      for (const client of clients) await client.close().catch(() => {});
      for (const socket of sockets) socket.terminate();
      if (!hasExited) {
        child.kill("SIGKILL");
        await exited;
      }
      await stub?.close();
      if (ownsDataDir) await rm(dataDir, { recursive: true, force: true });
    },
  };
  registerCleanup(() => engine.dispose());

  if (options.waitForReady !== false) {
    await waitForOutput("  output:   ");
    if (ipc) {
      const ready = (await waitForMessage((message) => message.type === "ready")) as ReadyMessage;
      port = ready.port;
      previewPort = ready.previewPort;
    } else {
      port = Number(/Unframed server {2}→ {2}http:\/\/localhost:(\d+)/.exec(stdout)?.[1]);
      previewPort = Number(/preview: {2}http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout)?.[1]);
    }
  }
  return engine;
};
