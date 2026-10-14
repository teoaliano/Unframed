/**
 * The stdio shim (spec 14): one process is one outside session. It reads the client's MCP messages
 * from stdin and writes one JSON-RPC answer per line to stdout, and relays each to the engine's
 * `/mcp` endpoint, found through the discovery file. While Unframed is closed it answers
 * `initialize` and `tools/list` itself, and every call with a sentence. Logs go to stderr only.
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import readline from "node:readline";
import { unframedToolCatalogue } from "./agent/toolCatalogue.ts";
import { outsideInitializeResult, outsideToolList } from "./agent/mcp.ts";

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Answer = { status: number; headers: http.IncomingHttpHeaders; body: unknown };

const NOT_OPEN = "Unframed is not open. Ask the person to open it, then try again.";
const REFUSED = "Unframed refused this connection. It was revoked or its token is wrong. The person can make a new one in Unframed's Settings.";
const NO_TOKEN = "This Unframed connection has no token. Copy the setup from Unframed's Settings again.";

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const dataDir = argument("--data-dir") ?? "";
const token = process.env.UNFRAMED_MCP_TOKEN ?? "";
/** The offline copy of the outside list: the same functions the engine answers with (spec 14). */
const offlineTools = () => outsideToolList(unframedToolCatalogue());

/** The engine's port, when the discovery file names a live process. */
const discover = (): number | undefined => {
  try {
    const found = JSON.parse(readFileSync(join(dataDir, "mcp-endpoint.json"), "utf8")) as { port?: unknown; pid?: unknown };
    if (typeof found.port !== "number" || typeof found.pid !== "number") return undefined;
    try {
      process.kill(found.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") return undefined;
    }
    return found.port;
  } catch {
    return undefined;
  }
};

const post = (port: number, body: unknown, sessionId: string | undefined): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          host: `127.0.0.1:${port}`,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(text),
          ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown;
          try {
            parsed = raw === "" ? undefined : JSON.parse(raw);
          } catch {
            parsed = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error("the engine did not answer in time")));
    req.on("error", reject);
    req.end(text);
  });

const write = (answer: unknown) => process.stdout.write(`${JSON.stringify(answer)}\n`);
const result = (id: Message["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const toolError = (id: Message["id"], text: string) => result(id, { content: [{ type: "text", text: JSON.stringify({ error: text }) }], isError: true });

let sessionId: string | undefined;
/** The client's `initialize` and `notifications/initialized`, kept while Unframed is closed, replayed when it opens. */
let keptInitialize: Message | undefined;
let keptInitialized: Message | undefined;

/** Whether the engine session is open: replays the kept handshake when there is one, and says so when the token is refused. */
const openSession = async (port: number): Promise<"open" | "closed" | "refused"> => {
  if (sessionId !== undefined) return "open";
  if (keptInitialize === undefined) return "closed";
  const opened = await post(port, keptInitialize, undefined).catch(() => undefined);
  if (opened === undefined) return "closed";
  if (opened.status === 401) return "refused";
  if (opened.status !== 200) return "closed";
  sessionId = String(opened.headers["mcp-session-id"] ?? "");
  if (keptInitialized !== undefined) await post(port, keptInitialized, sessionId).catch(() => undefined);
  return sessionId === "" ? "closed" : "open";
};

const handle = async (message: Message): Promise<unknown | undefined> => {
  const isNotification = message.id === undefined || message.id === null;
  const port = discover();
  if (message.method === "notifications/initialized") {
    keptInitialized = message;
    if (port !== undefined && sessionId !== undefined) await post(port, message, sessionId).catch(() => undefined);
    return undefined;
  }
  if (message.method === "initialize") {
    keptInitialize = message;
    if (port !== undefined) {
      const answer = await post(port, message, undefined).catch(() => undefined);
      if (answer?.status === 200) {
        sessionId = String(answer.headers["mcp-session-id"] ?? "");
        return answer.body;
      }
    }
    return result(message.id, outsideInitializeResult(message.params?.protocolVersion));
  }
  if (isNotification) return undefined;
  if (message.method === "ping") return port === undefined ? result(message.id, {}) : relay(port, message);
  if (message.method === "tools/list") {
    if (port !== undefined && (await openSession(port)) === "open") {
      const answer = await post(port, message, sessionId).catch(() => undefined);
      if (answer?.status === 200) return answer.body;
    }
    return result(message.id, { tools: offlineTools() });
  }
  if (message.method === "tools/call") {
    if (token === "") return toolError(message.id, NO_TOKEN);
    if (port === undefined) return toolError(message.id, NOT_OPEN);
    const session = await openSession(port);
    if (session === "refused") return toolError(message.id, REFUSED);
    if (session === "closed") return toolError(message.id, NOT_OPEN);
    const answer = await post(port, message, sessionId).catch(() => undefined);
    if (answer === undefined) return toolError(message.id, NOT_OPEN);
    if (answer.status === 401) return toolError(message.id, REFUSED);
    return answer.body;
  }
  return port === undefined ? result(message.id, {}) : relay(port, message);
};

const relay = async (port: number, message: Message): Promise<unknown> => {
  if ((await openSession(port)) !== "open") return result(message.id, {});
  const answer = await post(port, message, sessionId).catch(() => undefined);
  return answer?.status === 200 ? answer.body : result(message.id, {});
};

/** The session ends when the client closes stdin: MCP's DELETE, at most a second, then exit. */
const endSession = async (): Promise<void> => {
  const port = discover();
  if (port === undefined || sessionId === undefined) return;
  await new Promise<void>((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/mcp", method: "DELETE", headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${token}`, "mcp-session-id": sessionId } }, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });
    req.setTimeout(1000, () => req.destroy());
    req.on("error", () => resolve());
    req.end();
  });
};

let queue: Promise<void> = Promise.resolve();
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.trim() === "") return;
  queue = queue.then(async () => {
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      process.stderr.write(`mcp shim: a line was not JSON\n`);
      return;
    }
    const answer = await handle(message).catch((error: unknown) => {
      process.stderr.write(`mcp shim: ${error instanceof Error ? error.message : String(error)}\n`);
      return message.id === undefined || message.id === null ? undefined : result(message.id, {});
    });
    if (answer !== undefined) write(answer);
  });
});
lines.on("close", () => {
  void queue.then(endSession).then(() => process.exit(0));
});

