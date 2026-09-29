import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine, type EngineOptions, type RawResponse, type TestEngine } from "./harness.ts";
import { CONNECTED_KEY, oauthStub, type OAuthStub } from "./oauthStub.ts";
import { gate } from "./openRouterStub.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const KEY_REMOVED =
  "Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.";

interface Connecting {
  readonly engine: TestEngine;
  readonly rpc: TestRpcClient;
  readonly stub: OAuthStub;
  /** Approves at the stub's consent page and answers where it sends the browser. */
  approve(authorizeUrl: string): Promise<URL>;
  /** Lands a browser on the engine's callback, as the consent page's redirect would. */
  land(callback: URL): Promise<RawResponse>;
  /** Starts an attempt, approves it and lands on the callback. */
  connect(): Promise<RawResponse>;
}

const connecting = async (options: EngineOptions = {}): Promise<Connecting> => {
  const stub = oauthStub();
  const engine = await startEngine({ ...options, stub: stub.handler });
  const rpc = await engine.rpc();
  const approve = async (authorizeUrl: string) => {
    const response = await fetch(authorizeUrl, { redirect: "manual" });
    return new URL(response.headers.get("location")!);
  };
  const land = (callback: URL) => engine.request(`${callback.pathname}${callback.search}`, { headers: { host: callback.host } });
  return {
    engine,
    rpc,
    stub,
    approve,
    land,
    connect: async () => land(await approve((await rpc.call("oauth.start")).authorizeUrl)),
  };
};

describe("oauth.start", () => {
  it("answers an authorize URL on the OpenRouter origin whose callback points at the engine's own port, and the attempt reads waiting", async () => {
    const { engine, rpc } = await connecting();
    expect(await rpc.call("oauth.pending")).toEqual({ state: "none", reason: "" });
    const { authorizeUrl } = await rpc.call("oauth.start");
    const url = new URL(authorizeUrl);
    expect(url.origin).toBe(engine.stub!.origin);
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("callback_url")).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${engine.port}/api/oauth/callback/[0-9a-f]{32}$`));
    expect(await rpc.call("oauth.pending")).toEqual({ state: "waiting", reason: "" });
  });
});

describe("the OAuth callback", () => {
  it("exchanges the code with the matching verifier and S256, saves the key at 0600, says connected and emits the key", async () => {
    const { engine, rpc, stub, connect } = await connecting();
    const updates = rpc.subscribe("settings.subscribe");
    expect((await updates.next()).hasKey).toBe(false);

    const page = await connect();
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.text).toContain("<h1>Connected to OpenRouter</h1>");
    expect(page.text).toContain("<p>You can close this tab and return to Unframed.</p>");

    expect(stub.exchanges).toHaveLength(1);
    expect(stub.exchanges[0]!.verified).toBe(true);
    expect(stub.exchanges[0]!.body).toEqual({ code: "code-1", code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: "S256" });
    expect(stub.exchanges[0]!.headers["content-type"]).toBe("application/json");

    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${CONNECTED_KEY}\n`);
    expect((await stat(join(engine.dataDir, ".env"))).mode & 0o777).toBe(0o600);
    expect(await rpc.call("oauth.pending")).toEqual({ state: "done", reason: "" });
    expect(await updates.next()).toMatchObject({ hasKey: true, keyHint: "wxyz" });
    expect((await rpc.call("settings.get")).hasKey).toBe(true);
    await engine.waitForOutput("  oauth:    connected, key saved\n");
  });

  const NO_LONGER_VALID = "<h1>That link is no longer valid</h1>";

  it("refuses a replay of the same callback without a second exchange, leaving the key and the done state", async () => {
    const { engine, rpc, stub, approve, land } = await connecting();
    const callback = await approve((await rpc.call("oauth.start")).authorizeUrl);
    expect((await land(callback)).status).toBe(200);
    const replay = await land(callback);
    expect(replay.status).toBe(400);
    expect(replay.text).toContain(NO_LONGER_VALID);
    expect(replay.text).toContain("<p>Close this tab and press Connect in Unframed again.</p>");
    expect(stub.exchanges).toHaveLength(1);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_API_KEY=${CONNECTED_KEY}\n`);
    expect(await rpc.call("oauth.pending")).toEqual({ state: "done", reason: "" });
  });

  it("refuses the first attempt's callback once a second start superseded it", async () => {
    const { engine, rpc, stub, approve, land } = await connecting();
    const first = await approve((await rpc.call("oauth.start")).authorizeUrl);
    const second = await approve((await rpc.call("oauth.start")).authorizeUrl);
    const stale = await land(first);
    expect(stale.status).toBe(400);
    expect(stale.text).toContain(NO_LONGER_VALID);
    expect(stub.exchanges).toHaveLength(0);
    expect(await rpc.call("oauth.pending")).toEqual({ state: "waiting", reason: "" });
    expect((await land(second)).status).toBe(200);
    expect((await rpc.call("settings.get")).hasKey).toBe(true);
    expect(engine.stdout()).toContain("oauth:    connected, key saved");
  });

  it("answers 400 to a callback without a code, and the attempt reads failed", async () => {
    const { rpc, stub, approve, land } = await connecting();
    const callback = await approve((await rpc.call("oauth.start")).authorizeUrl);
    callback.searchParams.delete("code");
    const page = await land(callback);
    expect(page.status).toBe(400);
    expect(page.text).toContain("<h1>OpenRouter did not send a code</h1>");
    expect(page.text).toContain("<p>Close this tab and press Connect in Unframed again.</p>");
    expect(stub.exchanges).toHaveLength(0);
    expect(await rpc.call("oauth.pending")).toEqual({ state: "failed", reason: "Close this tab and press Connect in Unframed again." });
  });

  it.each([
    [
      "the stub drops the connection",
      { kind: "hangup" } as const,
      "Could not reach OpenRouter",
      /^other side closed|socket hang up|fetch failed/,
    ],
    [
      "a 403 with an error body",
      { kind: "status", status: 403, body: { error: { message: "This code was already used", code: 403 } } } as const,
      "OpenRouter could not complete the connection",
      /^This code was already used$/,
    ],
    [
      "a string error",
      { kind: "status", status: 400, body: { error: "Code expired" } } as const,
      "OpenRouter could not complete the connection",
      /^Code expired$/,
    ],
    [
      "a 500 with no body",
      { kind: "status", status: 500 } as const,
      "OpenRouter could not complete the connection",
      /^It answered 500\. Try connecting again\.$/,
    ],
    [
      "a 200 without a key",
      { kind: "status", status: 200, body: { user_id: "user_1" } } as const,
      "OpenRouter could not complete the connection",
      /^It answered 200\. Try connecting again\.$/,
    ],
  ])("answers 502 and fails the attempt when %s", async (_what, answer, heading, detail) => {
    const { engine, rpc, stub, connect } = await connecting();
    stub.exchange(() => answer);
    const page = await connect();
    expect(page.status).toBe(502);
    expect(page.text).toContain(`<h1>${heading}</h1>`);
    const pending = await rpc.call("oauth.pending");
    expect(pending.state).toBe("failed");
    expect(pending.reason).toMatch(detail);
    expect(page.text).toContain(`<p>${pending.reason}</p>`);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8").catch(() => "")).toBe("");
    // The engine keeps answering.
    expect((await rpc.call("server.health")).ok).toBe(true);
    expect((await connect()).status).toBe(502);
  });

  it("refuses a returned key in a shape the validator does not accept, and saves nothing", async () => {
    const { engine, rpc, stub, connect } = await connecting();
    stub.exchange(() => ({ kind: "key", key: "sk-or-v1-abc\nPORT=1" }));
    const page = await connect();
    expect(page.status).toBe(502);
    expect(page.text).toContain("<h1>OpenRouter returned a key in a shape Unframed does not recognise</h1>");
    expect(page.text).toContain("<p>Nothing was saved. You can paste a key manually in Unframed's settings instead.</p>");
    expect(await readFile(join(engine.dataDir, ".env"), "utf8").catch(() => "")).toBe("");
    expect((await rpc.call("settings.get")).hasKey).toBe(false);
    expect((await rpc.call("oauth.pending")).state).toBe("failed");
  });
});

const CANCELLED =
  "<h1>That connection was cancelled</h1>\n<p>Nothing was saved, and Unframed is still using whichever key you chose instead. OpenRouter did create a key just now, so delete that row at openrouter.ai/settings/keys.</p>";

/** A connection whose exchange is held at the stub until the test releases it. */
const heldConnection = async (options: EngineOptions = {}) => {
  const connection = await connecting(options);
  const hold = gate<void>();
  let reached!: () => void;
  const atStub = new Promise<void>((resolve) => (reached = resolve));
  connection.stub.exchange(async () => {
    reached();
    await hold.promise;
    return { kind: "key", key: CONNECTED_KEY };
  });
  const page = connection.connect();
  await atStub;
  return { ...connection, page, release: () => hold.release() };
};

describe("choosing a key while a connection is pending", () => {
  it("settings.removeKey during the held exchange: the callback answers cancelled and .env has no key", async () => {
    const { engine, rpc, page, release } = await heldConnection({ dotenv: "OPENROUTER_API_KEY=sk-or-v1-old-key-00001111\n" });
    await rpc.call("settings.removeKey");
    release();
    const answered = await page;
    expect(answered.status).toBe(409);
    expect(answered.text).toContain(CANCELLED);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("");
    expect((await rpc.call("settings.get")).hasKey).toBe(false);
  });

  it("settings.update with a pasted key during the held exchange: the callback answers cancelled and .env holds the pasted key", async () => {
    const { engine, rpc, page, release } = await heldConnection();
    await rpc.call("settings.update", { key: "sk-or-v1-pasted-key-2222" });
    release();
    const answered = await page;
    expect(answered.status).toBe(409);
    expect(answered.text).toContain(CANCELLED);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("OPENROUTER_API_KEY=sk-or-v1-pasted-key-2222\n");
    expect((await rpc.call("settings.get")).keyHint).toBe("2222");
    expect(await rpc.call("oauth.pending")).toEqual({ state: "none", reason: "" });
  });

  it("settings.update with only a model change leaves the pending attempt waiting, and it still completes", async () => {
    const { engine, rpc, page, release } = await heldConnection();
    await rpc.call("settings.update", { textModel: "anthropic/claude-sonnet-5" });
    expect(await rpc.call("oauth.pending")).toEqual({ state: "waiting", reason: "" });
    release();
    expect((await page).status).toBe(200);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe(`OPENROUTER_TEXT_MODEL=anthropic/claude-sonnet-5\nOPENROUTER_API_KEY=${CONNECTED_KEY}\n`);
  });
});

describe("oauth.cancel", () => {
  it("while waiting leaves an existing key untouched, and a later callback is refused", async () => {
    const { engine, rpc, approve, land } = await connecting({ dotenv: "OPENROUTER_API_KEY=sk-or-v1-kept-key-33334444\n" });
    const callback = await approve((await rpc.call("oauth.start")).authorizeUrl);
    expect(await rpc.call("oauth.cancel")).toEqual({ endedRenders: 0 });
    expect(await rpc.call("oauth.pending")).toEqual({ state: "none", reason: "" });
    const page = await land(callback);
    expect(page.status).toBe(400);
    expect(page.text).toContain("<h1>That link is no longer valid</h1>");
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("OPENROUTER_API_KEY=sk-or-v1-kept-key-33334444\n");
    expect((await rpc.call("settings.get")).keyHint).toBe("4444");
  });

  it("after done removes the key the connection wrote, and hasKey becomes false", async () => {
    const { engine, rpc, connect } = await connecting();
    const updates = rpc.subscribe("settings.subscribe");
    expect((await connect()).status).toBe(200);
    expect((await rpc.call("settings.get")).hasKey).toBe(true);
    expect(await rpc.call("oauth.cancel")).toEqual({ endedRenders: 0 });
    expect((await rpc.call("settings.get")).hasKey).toBe(false);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("");
    await expect.poll(() => updates.values.at(-1)?.hasKey).toBe(false);
  });

  /** An engine whose output folder already holds `jobs.json` with this text. */
  const withJobs = async (text: string) => {
    const dataDir = await makeTempDir();
    await mkdir(join(dataDir, "output"), { recursive: true });
    await writeFile(join(dataDir, "output", "jobs.json"), text);
    const connection = await connecting({ dataDir });
    return { ...connection, jobs: async () => JSON.parse(await readFile(join(dataDir, "output", "jobs.json"), "utf8")) as any[] };
  };

  const pendingJob = (id: string) => ({
    id,
    project: "board",
    params: { prompt: "a render", model: "bytedance/seedance-2.0", duration: 5, resolution: null, size: null },
    startedAt: Date.now() - 60_000,
    status: "pending",
  });

  it("after done is a key removal: every pending render fails with the key-removed error and the answer counts them", async () => {
    const { rpc, connect, jobs } = await withJobs(JSON.stringify([pendingJob("job-a"), pendingJob("job-b"), { ...pendingJob("job-c"), status: "done", resolvedAt: Date.now() }]));
    expect((await connect()).status).toBe(200);
    const before = Date.now();
    expect(await rpc.call("oauth.cancel")).toEqual({ endedRenders: 2 });
    const stored = await jobs();
    for (const id of ["job-a", "job-b"]) {
      const job = stored.find((each) => each.id === id);
      expect(job).toMatchObject({ status: "failed", error: KEY_REMOVED });
      expect(job.resolvedAt).toBeGreaterThanOrEqual(before);
    }
    expect(stored.find((each) => each.id === "job-c").status).toBe("done");
    expect((await rpc.call("settings.get")).hasKey).toBe(false);
  });

  it("after done says the renders could not be stopped when the job store is unreadable, and still removes the key", async () => {
    const { rpc, connect, engine } = await withJobs("{ broken");
    expect((await connect()).status).toBe(200);
    const answer = await rpc.call("oauth.cancel");
    expect(answer.endedRenders).toBe(0);
    expect(answer.renderCleanupError).toMatch(/^The key was removed, but renders already in progress could not be stopped: The job store at .+ is not valid JSON: .+/);
    expect(await readFile(join(engine.dataDir, ".env"), "utf8")).toBe("");
  });

  it("while waiting ends no renders", async () => {
    const { rpc, jobs } = await withJobs(JSON.stringify([pendingJob("job-a")]));
    await rpc.call("oauth.start");
    expect(await rpc.call("oauth.cancel")).toEqual({ endedRenders: 0 });
    expect((await jobs())[0].status).toBe("pending");
  });
});

describe("the callback page", () => {
  it("answers 500 with the cleanup detail when the key cannot be saved, and the attempt reads failed", async () => {
    const { engine, rpc, connect } = await connecting({ dotenv: "OPENROUTER_TEXT_MODEL=anthropic/claude-sonnet-5\n" });
    const envPath = join(engine.dataDir, ".env");
    await chmod(envPath, 0o000);
    try {
      const page = await connect();
      expect(page.status).toBe(500);
      expect(page.text).toContain("<h1>OpenRouter created a key, but Unframed could not save it</h1>");
      expect(page.text).toMatch(
        /<p>EACCES: permission denied, open '[^']+\.env'\. The key exists in your OpenRouter account\. You can delete it at openrouter\.ai\/settings\/keys and try connecting again\.<\/p>/,
      );
      const pending = await rpc.call("oauth.pending");
      expect(pending.state).toBe("failed");
      expect(pending.reason).toMatch(/^EACCES: .*\. The key exists in your OpenRouter account\. You can delete it at openrouter\.ai\/settings\/keys and try connecting again\.$/);
      expect((await rpc.call("settings.get")).hasKey).toBe(false);
    } finally {
      await chmod(envPath, 0o600);
    }
    expect(await readFile(envPath, "utf8")).toBe("OPENROUTER_TEXT_MODEL=anthropic/claude-sonnet-5\n");
  });

  it("is a dark page titled Unframed that escapes OpenRouter's words", async () => {
    const { stub, connect } = await connecting();
    stub.exchange(() => ({ kind: "status", status: 403, body: { error: { message: `<script>alert("x")</script> & more` } } }));
    const page = await connect();
    expect(page.status).toBe(502);
    expect(page.text.startsWith("<!doctype html>")).toBe(true);
    expect(page.text).toContain('<meta charset="utf-8">');
    expect(page.text).toContain("<title>Unframed</title>");
    expect(page.text).toContain("color-scheme: dark");
    expect(page.text).toMatch(/body \{[^}]*margin: 0;[^}]*background: #111112;[^}]*color: #DFE2E5;/);
    expect(page.text).toMatch(/max-width: 32em; margin: 12vh auto 0; padding: 0 1\.5em;/);
    expect(page.text).toContain("font-size: 16px; line-height: 1.5;");
    expect(page.text).toContain("h1 { font-size: 1.3em; }");
    expect(page.text).not.toContain("<script>");
    expect(page.text).toContain(`<p>&lt;script&gt;alert("x")&lt;/script&gt; &amp; more</p>`);
    expect(page.text).not.toMatch(/<a |http-equiv="refresh"|<script/);
  });
});

describe("oauth.status", () => {
  const KEY = "sk-or-v1-status-key-00005678";

  it("answers hasKey false without a key, and never asks OpenRouter", async () => {
    const { rpc, stub } = await connecting();
    expect(await rpc.call("oauth.status")).toEqual({ hasKey: false });
    expect(stub.keyRequests).toHaveLength(0);
  });

  it.each([401, 403])("reads a %i as a revoked key", async (status) => {
    const { rpc, stub } = await connecting({ dotenv: `OPENROUTER_API_KEY=${KEY}\n` });
    stub.keyStatus(() => ({ kind: "status", status, body: { error: { message: "No auth credentials found" } } }));
    expect(await rpc.call("oauth.status")).toEqual({ hasKey: true, revoked: true });
    expect(stub.keyRequests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("coerces a 2xx and drops everything else it carries, the label and limit_reset included", async () => {
    const { rpc, stub } = await connecting({ dotenv: `OPENROUTER_API_KEY=${KEY}\n` });
    stub.keyStatus(() => ({
      kind: "data",
      data: { label: "sk-or-v1-sta...678", usage: "7.44", limit_remaining: 3, expires_at: "2026-10-01T00:00:00Z", is_free_tier: false, limit_reset: "monthly" },
    }));
    const status = await rpc.call("oauth.status");
    expect(status).toEqual({ hasKey: true, usage: 0, limit: null, limitRemaining: 3, expiresAt: "2026-10-01T00:00:00Z", isFreeTier: false });
    expect(JSON.stringify(status)).not.toMatch(/label|limit_reset|monthly|sta\.\.\./);

    stub.keyStatus(() => ({ kind: "data", data: { usage: 1.5, limit: 10, limit_remaining: 8.5, expires_at: null, is_free_tier: true } }));
    expect(await rpc.call("oauth.status")).toEqual({ hasKey: true, usage: 1.5, limit: 10, limitRemaining: 8.5, expiresAt: null, isFreeTier: true });
  });

  it("answers upstream with OpenRouter's status for any other failure, and for an answer with no data", async () => {
    const { rpc, stub } = await connecting({ dotenv: `OPENROUTER_API_KEY=${KEY}\n` });
    stub.keyStatus(() => ({ kind: "status", status: 500 }));
    await expect(rpc.call("oauth.status")).rejects.toMatchObject({ code: "upstream", message: "OpenRouter answered 500." });
    stub.keyStatus(() => ({ kind: "status", status: 200, body: { nothing: true } }));
    await expect(rpc.call("oauth.status")).rejects.toMatchObject({ code: "upstream", message: "OpenRouter answered 200." });
  });

  it("answers upstream with the error when OpenRouter cannot be reached", async () => {
    const { engine, rpc } = await connecting({ dotenv: `OPENROUTER_API_KEY=${KEY}\n` });
    await engine.stub!.close();
    await expect(rpc.call("oauth.status")).rejects.toMatchObject({ code: "upstream", message: expect.stringMatching(/ECONNREFUSED|fetch failed/) });
  });
});

describe("with a bounce page", () => {
  it("sends OpenRouter the bounce form of the callback, and the loopback route still completes the flow", async () => {
    const { engine, rpc, stub, approve, land } = await connecting({ env: { UNFRAMED_OAUTH_BOUNCE: "https://unframed.example/connect/" } });
    const { authorizeUrl } = await rpc.call("oauth.start");
    const callback = new URL(authorizeUrl).searchParams.get("callback_url")!;
    const match = /^https:\/\/unframed\.example\/connect\/(\d+)-([0-9a-f]{32})$/.exec(callback);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(engine.port);
    // The bounce page builds the loopback URL from the port and nonce and passes the code on.
    const bounced = await approve(authorizeUrl);
    const loopback = new URL(`http://127.0.0.1:${match![1]}/api/oauth/callback/${match![2]}?code=${bounced.searchParams.get("code")}`);
    const page = await land(loopback);
    expect(page.status).toBe(200);
    expect(stub.exchanges[0]!.verified).toBe(true);
    expect((await rpc.call("settings.get")).hasKey).toBe(true);
  });
});
