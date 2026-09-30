import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/** A message `codex app-server` sends: a response, a notification or a request of its own. */
export type CodexIncoming =
  | { readonly id: number | string; readonly result?: unknown; readonly error?: { code?: number; message?: string } }
  | { readonly method: string; readonly params?: unknown; readonly id?: undefined }
  | { readonly id: number | string; readonly method: string; readonly params?: unknown };

export class CodexRpcError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

export interface CodexRpcOptions {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string>;
  readonly cwd?: string;
  readonly onNotification?: (method: string, params: unknown) => void;
  /** Answers a server request; a thrown error answers method-not-found. */
  readonly onRequest?: (method: string, params: unknown) => Promise<unknown>;
  readonly onStderr?: (line: string) => void;
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

/**
 * One `codex app-server` process, speaking newline-delimited JSON messages
 * `{id, method, params}` with no `jsonrpc` field.
 */
export class CodexRpc {
  private readonly child: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private exited = false;
  readonly done: Promise<void>;

  constructor(options: CodexRpcOptions) {
    this.child = spawn(options.executable, [...options.args], {
      env: options.env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let resolveDone!: () => void;
    this.done = new Promise((resolve) => (resolveDone = resolve));
    const fail = (error: Error) => {
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    };
    this.child.on("error", (error) => {
      this.exited = true;
      fail(error);
      resolveDone();
    });
    this.child.on("exit", (code, signal) => {
      this.exited = true;
      fail(new CodexRpcError(`codex app-server exited (${code ?? signal})`));
      options.onExit?.(code, signal);
      resolveDone();
    });
    this.child.stdin?.on("error", () => {});
    if (this.child.stderr) createInterface({ input: this.child.stderr }).on("line", (line) => options.onStderr?.(line));
    if (this.child.stdout) {
      createInterface({ input: this.child.stdout }).on("line", (line) => {
        if (line.trim() === "") return;
        let message: CodexIncoming;
        try {
          message = JSON.parse(line) as CodexIncoming;
        } catch {
          options.onStderr?.(`unreadable line: ${line.slice(0, 200)}`);
          return;
        }
        this.receive(message, options);
      });
    }
  }

  private receive(message: CodexIncoming, options: CodexRpcOptions): void {
    if ("method" in message && typeof message.method === "string") {
      if (message.id !== undefined) {
        const id = message.id;
        const answer = options.onRequest
          ? options.onRequest(message.method, message.params)
          : Promise.reject(new CodexRpcError("method not found", -32601));
        answer.then(
          (result) => this.write({ id, result }),
          (error: unknown) =>
            this.write({
              id,
              error: {
                code: error instanceof CodexRpcError && error.code !== undefined ? error.code : -32601,
                message: error instanceof Error ? error.message : "method not found",
              },
            }),
        );
        return;
      }
      options.onNotification?.(message.method, message.params);
      return;
    }
    const id = typeof message.id === "number" ? message.id : Number(message.id);
    const waiter = this.pending.get(id);
    if (!waiter) return;
    this.pending.delete(id);
    const response = message as { result?: unknown; error?: { code?: number; message?: string } };
    if (response.error) waiter.reject(new CodexRpcError(response.error.message ?? "codex request failed", response.error.code));
    else waiter.resolve(response.result);
  }

  private write(message: unknown): void {
    if (this.exited || !this.child.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.exited) return Promise.reject(new CodexRpcError("codex app-server is not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexRpcError(`codex ${method} timed out`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  get running(): boolean {
    return !this.exited;
  }

  close(): void {
    if (this.exited) return;
    this.child.stdin?.end();
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (!this.exited) this.child.kill("SIGKILL");
    }, 1000);
    timer.unref();
  }
}

/** `initialize` then `initialized`, as every Codex session starts. */
export const initializeCodex = async (rpc: CodexRpc, version: string): Promise<unknown> => {
  const result = await rpc.request("initialize", {
    clientInfo: { name: "unframed", title: "Unframed", version },
    capabilities: { experimentalApi: true },
  });
  rpc.notify("initialized");
  return result;
};
