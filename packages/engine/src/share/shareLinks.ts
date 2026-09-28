/**
 * The share link service (spec 04): a local clip served publicly for the life of one render
 * job, so OpenRouter's video endpoint can fetch it. Behind five calls sit a dedicated share
 * server, temp copies, the expiry timer, the tunnel and the outside reachability probe.
 *
 * The share server bends contract 1 on purpose: it applies no Host or Origin check, because
 * the tunnel forwards a public hostname to it. That is safe only because nothing but the
 * share route exists on it. Never mount anything else on this server.
 */
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShareRegistry, SHARE_TTL_MS, shareMime, shareTokenOf, tokenFromBytes } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import localtunnel from "localtunnel";
import { listenLoopback } from "../listen.ts";
import { errorText, logError } from "../log.ts";
import { Config } from "../services.ts";
import { Shutdown } from "../shutdown.ts";

export interface ShareLinksService {
  /** Copies a project file to a temp file and registers it; answers its token. */
  readonly mint: (projectFile: string) => Promise<string>;
  /** Removes a registration and its temp copy. With none left, the tunnel closes. */
  readonly revoke: (token: string) => Promise<void>;
  /** The public base URL of the one tunnel to the share server, opening it when needed. */
  readonly ensureTunnel: () => Promise<string>;
  /** Whether `url` answers 200 from outside this machine before `timeoutMs` runs out. */
  readonly waitUntilPublic: (url: string, timeoutMs: number) => Promise<boolean>;
  readonly closeTunnel: () => Promise<void>;
}

export class ShareLinks extends Context.Service<ShareLinks, ShareLinksService>()("unframed/engine/ShareLinks") {}

const EXPIRY_CHECK_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_PAUSE_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A-record IPs of `host` over DNS-over-HTTPS: the local resolver can say NXDOMAIN for a name already live at the edge. */
const resolveOverHttps = async (host: string): Promise<string[]> => {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const answer = (await response.json()) as { Answer?: Array<{ type?: number; data?: string }> };
  return (answer.Answer ?? []).filter((record) => record.type === 1 && typeof record.data === "string").map((record) => record.data!);
};

/** An HTTPS HEAD for `path` sent to one IP, with SNI and Host set to the hostname. */
const headThrough = (ip: string, host: string, path: string): Promise<number | undefined> =>
  new Promise((resolve) => {
    const request = https.request({ host: ip, servername: host, method: "HEAD", path, headers: { host }, timeout: PROBE_TIMEOUT_MS }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(undefined));
    request.end();
  });

const plainHead = async (url: string): Promise<number | undefined> => {
  try {
    return (await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })).status;
  } catch {
    return undefined;
  }
};

export const shareLinksLayer = Layer.effect(
  ShareLinks,
  Effect.gen(function* () {
    const config = yield* Config;
    const shutdown = yield* Shutdown;
    const ttl = config.testShareTtlMs ?? SHARE_TTL_MS;
    const registry = createShareRegistry<string>(ttl);

    let server: Promise<{ readonly server: http.Server; readonly port: number }> | undefined;
    let tunnel: localtunnel.Tunnel | undefined;
    let expiry: ReturnType<typeof setInterval> | undefined;

    const notFound = (res: http.ServerResponse) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    };

    // The only route: GET or HEAD /share/<token>, matched against the raw request path.
    const handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
      const token = req.method === "GET" || req.method === "HEAD" ? shareTokenOf(req.url ?? "") : undefined;
      const entry = token === undefined ? undefined : registry.get(token, Date.now());
      if (!entry) return notFound(res);
      stat(entry.file).then(
        (info) => {
          res.writeHead(200, { "content-type": entry.mime, "content-length": String(info.size) });
          if (req.method === "HEAD") return res.end();
          const stream = createReadStream(entry.file);
          stream.on("error", () => res.destroy());
          stream.pipe(res);
        },
        () => notFound(res),
      );
    };

    const shareServer = () =>
      (server ??= (async () => {
        const made = http.createServer(handle);
        const port = await listenLoopback(made, 0);
        return { server: made, port };
      })());

    const closeTunnel = async () => {
      const open = tunnel;
      tunnel = undefined;
      try {
        open?.close();
      } catch (error) {
        logError(`share tunnel: could not close: ${errorText(error)}`);
      }
    };

    const revoke = async (token: string) => {
      const entry = registry.remove(token);
      if (entry) await rm(entry.file, { force: true }).catch(() => {});
      if (!registry.tunnelNeeded()) await closeTunnel();
    };

    const mint = async (projectFile: string) => {
      await shareServer();
      const token = tokenFromBytes(randomBytes(32));
      const file = join(tmpdir(), `unframed-share-${token}.bin`);
      await copyFile(projectFile, file);
      registry.add(token, { file, mime: shareMime(projectFile) }, Date.now());
      // The TTL is a backstop; the normal end is revocation when the job ends.
      expiry ??= setInterval(
        () => {
          for (const expired of registry.expired(Date.now())) void revoke(expired);
        },
        Math.min(EXPIRY_CHECK_MS, ttl),
      );
      expiry.unref();
      return token;
    };

    const ensureTunnel = async () => {
      const { port } = await shareServer();
      if (config.testTunnel !== undefined) return `http://127.0.0.1:${port}`;
      if (tunnel) return tunnel.url;
      const opened = await localtunnel({ port, local_host: "127.0.0.1" });
      opened.on("error", (error: unknown) => logError(`share tunnel: ${errorText(error)}`));
      tunnel = opened;
      return opened.url;
    };

    const waitUntilPublic = async (url: string, timeoutMs: number) => {
      if (config.testTunnel === "never") return false;
      const deadline = Date.now() + timeoutMs;
      const target = new URL(url);
      for (;;) {
        if (config.testTunnel === "loopback") {
          if ((await plainHead(url)) === 200) return true;
        } else {
          const ips = await resolveOverHttps(target.hostname).catch(() => []);
          for (const ip of ips) if ((await headThrough(ip, target.hostname, target.pathname)) === 200) return true;
        }
        if (Date.now() + PROBE_PAUSE_MS >= deadline) return false;
        await sleep(PROBE_PAUSE_MS);
      }
    };

    // No orphan tunnel outlives the process.
    process.on("exit", () => {
      try {
        tunnel?.close();
      } catch {
        // exiting anyway
      }
    });
    yield* shutdown.register(
      "share tunnel",
      Effect.promise(async () => {
        if (expiry) clearInterval(expiry);
        await closeTunnel();
        const open = server;
        server = undefined;
        if (open) (await open).server.close();
      }),
    );

    return ShareLinks.of({ mint, revoke, ensureTunnel, waitUntilPublic, closeTunnel });
  }),
);
