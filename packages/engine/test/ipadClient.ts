import { mkdir, readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import { join } from "node:path";
import WebSocket, { type ClientOptions } from "ws";
import { makeTempDir, startEngine, type RawResponse, type TestEngine } from "./harness.ts";
import { connectRpc, type TestRpcClient } from "./rpcClient.ts";

export const TEST_NAME = "localhost";

export interface IpadEngineOptions {
  readonly port?: string;
  readonly access?: boolean;
  readonly hosted?: boolean;
  readonly dataDir?: string;
  readonly name?: string;
}

export const startIpadEngine = async (options: IpadEngineOptions = {}): Promise<TestEngine> => {
  const dist = options.hosted === false ? undefined : await makeTempDir("unframed-client-");
  if (dist !== undefined) {
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), "<!doctype html><title>Unframed</title>");
    await writeFile(join(dist, "assets", "app.js"), "export const app = 1;\n");
    await writeFile(join(dist, "manifest.webmanifest"), '{"name":"Unframed","display":"standalone"}');
    await writeFile(join(dist, "apple-touch-icon.png"), "icon bytes");
  }
  return startEngine({
    ...(dist === undefined ? {} : { clientDist: dist }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    dotenv: options.access === false ? "" : "IPAD_ACCESS=on\n",
    env: { UNFRAMED_TEST_IPAD: options.name ?? TEST_NAME, IPAD_PORT: options.port ?? "0" },
  });
};

export const readAuthority = (dataDir: string): Promise<string> => readFile(join(dataDir, "ipad", "ca.pem"), "utf8");

export interface DeviceRequestOptions {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  token?: string;
  host?: string;
  servername?: string;
  address?: string;
}

export const deviceRequest = (port: number, ca: string, path: string, options: DeviceRequestOptions = {}): Promise<RawResponse> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: options.host ?? `${TEST_NAME}:${port}` };
    if (options.token !== undefined) headers.cookie = `unframed_device=${options.token}`;
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (value === undefined) delete headers[name.toLowerCase()];
      else headers[name.toLowerCase()] = value;
    }
    const req = https.request(
      {
        host: options.address ?? "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers,
        setHost: false,
        ca: [ca],
        servername: options.servername ?? TEST_NAME,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
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

export const deviceSocket = (port: number, ca: string, path: string, options: { token?: string; host?: string } = {}): WebSocket => {
  const headers: Record<string, string> = { host: options.host ?? `${TEST_NAME}:${port}` };
  if (options.token !== undefined) headers.cookie = `unframed_device=${options.token}`;
  const socket = new WebSocket(`wss://127.0.0.1:${port}${path}`, [], { ca: [ca], servername: TEST_NAME, headers } as unknown as ClientOptions);
  socket.on("error", () => {});
  return socket;
};

export const deviceRpc = async (port: number, ca: string, token: string): Promise<TestRpcClient> =>
  connectRpc(`wss://127.0.0.1:${port}/ws`, {
    ca,
    servername: TEST_NAME,
    headers: { host: `${TEST_NAME}:${port}`, cookie: `unframed_device=${token}` },
  });

export const ipadPortOf = async (engine: TestEngine): Promise<number> => {
  const status = await (await engine.rpc()).call("ipad.status");
  if (!status.listening) throw new Error(`the iPad listener is not up: ${JSON.stringify(status)}`);
  return status.port;
};
