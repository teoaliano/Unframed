import { describe, expect, it } from "vitest";
import {
  BRIDGE_PATH,
  bridgeTag,
  htmlInjector,
  proxiedResponseHeaders,
  rewriteLocation,
  screenBridgeSource,
  upstreamRequestHeaders,
} from "../src/index.ts";

const proxyOrigin = "http://127.0.0.1:4101";

describe("Location rewriting", () => {
  it.each([
    ["http://localhost:3000/", "http://127.0.0.1:4101/"],
    ["http://127.0.0.1:3000/dashboard?tab=1", "http://127.0.0.1:4101/dashboard?tab=1"],
    ["http://[::1]:3000#top", "http://127.0.0.1:4101#top"],
    ["http://LOCALHOST:3000", "http://127.0.0.1:4101"],
  ])("points %j at the proxy", (location, rewritten) => {
    expect(rewriteLocation(location, 3000, proxyOrigin)).toBe(rewritten);
  });

  it.each([["/relative"], ["http://localhost:30001/"], ["http://localhost:4000/"], ["https://accounts.example.com/login?next=http://localhost:3000/"], ["http://evil.localhost:3000/"]])(
    "keeps %j",
    (location) => {
      expect(rewriteLocation(location, 3000, proxyOrigin)).toBe(location);
    },
  );
});

describe("upstream request headers", () => {
  const base = { host: "127.0.0.1:4101", origin: "http://127.0.0.1:4101", accept: "*/*", cookie: "session=1" };

  it("keeps the browser's Host and Origin on ordinary requests", () => {
    expect(upstreamRequestHeaders(base, { path: "/dashboard", upgrade: false })).toEqual(base);
  });

  it.each([["/_next/static/chunk.js"], ["/__nextjs_original-stack-frames"]])("rewrites Origin to the proxy on localhost on %j and keeps Host", (path) => {
    expect(upstreamRequestHeaders(base, { path, upgrade: false })).toEqual({ ...base, origin: "http://localhost:4101" });
  });

  it.each([["/_next/webpack-hmr?page=/"], ["/?token=abc"], ["/ws"]])("gives an upgrade on %j an Origin and a Host that agree, both the proxy on localhost", (path) => {
    expect(upstreamRequestHeaders(base, { path, upgrade: true })).toEqual({ ...base, host: "localhost:4101", origin: "http://localhost:4101" });
    expect(upstreamRequestHeaders({ ...base, host: "localhost:4101", origin: "http://localhost:4101" }, { path, upgrade: true })).toEqual({ ...base, host: "localhost:4101", origin: "http://localhost:4101" });
  });

  it("adds no Origin where the browser sent none, and leaves Host alone then", () => {
    const { origin: _origin, ...noOrigin } = base;
    expect(upstreamRequestHeaders(noOrigin, { path: "/_next/x", upgrade: true })).toEqual(noOrigin);
  });

  it.each([["null"], ["https://evil.example"], ["http://127.0.0.1:3000"], ["http://localhost"]])("rewrites neither Origin %j nor Host when the Origin does not name the proxy", (origin) => {
    expect(upstreamRequestHeaders({ ...base, origin }, { path: "/ws", upgrade: true })).toEqual({ ...base, origin });
  });

  it("drops the cookies of an unsafe request another site started, the way SameSite=Lax would have", () => {
    const posted = { ...base, cookie: "s=1", "sec-fetch-site": "cross-site" };
    expect(upstreamRequestHeaders({ ...posted, origin: "https://evil.example" }, { path: "/api", upgrade: false, method: "POST" }).cookie).toBeUndefined();
    expect(upstreamRequestHeaders({ ...posted, origin: undefined }, { path: "/api", upgrade: false, method: "POST" }).cookie).toBeUndefined();
    expect(upstreamRequestHeaders({ ...posted, origin: "http://127.0.0.1:4000" }, { path: "/api", upgrade: false, method: "POST" }).cookie).toBe("s=1");
    expect(upstreamRequestHeaders({ ...posted, origin: "https://evil.example" }, { path: "/api", upgrade: false, method: "GET" }).cookie).toBe("s=1");
    expect(upstreamRequestHeaders({ ...posted, "sec-fetch-site": "same-origin" }, { path: "/api", upgrade: false, method: "POST" }).cookie).toBe("s=1");
  });

  it("asks for an unencoded body when the request accepts HTML", () => {
    const headers = { ...base, accept: "text/html,application/xhtml+xml", "accept-encoding": "gzip, br" };
    expect(upstreamRequestHeaders(headers, { path: "/", upgrade: false })["accept-encoding"]).toBe("identity");
    expect(upstreamRequestHeaders({ ...base, "accept-encoding": "gzip" }, { path: "/app.js", upgrade: false })["accept-encoding"]).toBe("gzip");
  });
});

describe("proxied response headers", () => {
  it("strips X-Frame-Options and frame-ancestors, keeps the rest of the CSP, and rewrites Location", () => {
    const answered = proxiedResponseHeaders(
      {
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'; script-src 'self'; img-src *",
        location: "http://localhost:3000/",
        "set-cookie": ["a=1; SameSite=Lax"],
      },
      { upstreamPort: 3000, proxyOrigin },
    );
    expect(answered.headers).toEqual({
      "content-security-policy": "script-src 'self'; img-src *",
      location: "http://127.0.0.1:4101/",
      "set-cookie": ["a=1; SameSite=None; Secure"],
    });
    expect(answered.nonce).toBeUndefined();
  });

  it("marks every cookie SameSite=None and Secure, so it holds in a frame on another site", () => {
    expect(proxiedResponseHeaders({ "set-cookie": "s=1; Path=/; samesite=strict; HttpOnly" }, { upstreamPort: 3000, proxyOrigin }).headers["set-cookie"]).toEqual(["s=1; Path=/; HttpOnly; SameSite=None; Secure"]);
    expect(proxiedResponseHeaders({ "set-cookie": ["a=1; Secure; SameSite=Lax", "b=2"] }, { upstreamPort: 3000, proxyOrigin }).headers["set-cookie"]).toEqual(["a=1; SameSite=None; Secure", "b=2; SameSite=None; Secure"]);
  });

  it("drops a CSP that only held frame-ancestors", () => {
    expect(proxiedResponseHeaders({ "content-security-policy": "frame-ancestors 'self'" }, { upstreamPort: 3000, proxyOrigin }).headers).toEqual({});
  });

  it("finds the script nonce so the injected tag can carry it", () => {
    const answered = proxiedResponseHeaders({ "content-security-policy": "default-src 'self'; script-src 'nonce-r4nd0m+/=' 'strict-dynamic'" }, { upstreamPort: 3000, proxyOrigin });
    expect(answered.nonce).toBe("r4nd0m+/=");
    expect(bridgeTag(answered.nonce)).toBe(`<script src="${BRIDGE_PATH}" nonce="r4nd0m+/="></script>`);
    expect(bridgeTag(undefined)).toBe('<script src="/__unframed/bridge.js"></script>');
    expect(proxiedResponseHeaders({ "content-security-policy": "default-src 'nonce-abc'" }, { upstreamPort: 3000, proxyOrigin }).nonce).toBe("abc");
  });
});

describe("HTML injection over a stream", () => {
  const TAG = bridgeTag(undefined);
  const run = (chunks: ReadonlyArray<string>) => {
    const injector = htmlInjector(TAG);
    const out = chunks.map((chunk) => injector.push(chunk)).join("") + injector.end();
    return { out, injected: injector.injected() };
  };

  it("puts the tag right after <head>", () => {
    expect(run(["<!doctype html><html><head><title>x</title></head><body></body></html>"])).toEqual({
      out: `<!doctype html><html><head>${TAG}<title>x</title></head><body></body></html>`,
      injected: true,
    });
  });

  it("finds a <head> with attributes, in any case", () => {
    expect(run(['<html><HEAD lang="en">', "<title>x</title>"]).out).toBe(`<html><HEAD lang="en">${TAG}<title>x</title>`);
  });

  it.each([
    [["<html><he", "ad><title>x</title>"]],
    [["<html><", "head", "><title>x</title>"]],
    [["<html><head data-x=\"1", "\"><title>x</title>"]],
    [[..."<html><head><title>x</title>"]],
  ])("finds a <head> split across chunks %j", (chunks) => {
    const head = chunks.join("").slice(0, chunks.join("").indexOf("<title>"));
    expect(run(chunks)).toEqual({ out: `${head}${TAG}<title>x</title>`, injected: true });
  });

  it("streams what comes before <head> without holding it back", () => {
    const injector = htmlInjector(TAG);
    expect(injector.push("<!doctype html><html lang=\"en\">")).toBe("<!doctype html><html lang=\"en\">");
    expect(injector.push("<he")).toBe("");
    expect(injector.push("ad>")).toBe(`<head>${TAG}`);
    expect(injector.push("<title>")).toBe("<title>");
  });

  it("does not take <header> for <head>", () => {
    expect(run(["<html><body><header>x</header></body></html>"])).toEqual({ out: "<html><body><header>x</header></body></html>", injected: false });
  });

  it("passes through untouched when <body> comes first or the stream ends", () => {
    expect(run(["<html><bo", "dy><head></head></body>"])).toEqual({ out: "<html><body><head></head></body>", injected: false });
    expect(run(["just text <", "b"])).toEqual({ out: "just text <b", injected: false });
    expect(run([""])).toEqual({ out: "", injected: false });
  });

  it("passes everything after the injection through unchanged", () => {
    expect(run(["<head>", "<head>", "</head>"]).out).toBe(`<head>${TAG}<head></head>`);
  });
});

describe("the Screen bridge", () => {
  const load = (ancestor: string | undefined, extra: Record<string, unknown> = {}) => {
    const posted: Array<{ message: any; to: string }> = [];
    const listeners: Record<string, Array<(event: any) => void>> = {};
    const frames: Array<() => void> = [];
    const parent = { postMessage: (message: unknown, to: string) => posted.push({ message, to }) };
    const win: any = {
      parent,
      location: { origin: "http://127.0.0.1:4101", href: "http://127.0.0.1:4101/dashboard", pathname: "/dashboard", search: "", hash: "", ancestorOrigins: ancestor === undefined ? [] : [ancestor] },
      document: { readyState: "loading", referrer: "", head: { appendChild: () => undefined }, createElement: () => ({ src: "" }), addEventListener: () => undefined, querySelector: () => null },
      console: { error: () => undefined },
      addEventListener: (type: string, listener: (event: any) => void) => (listeners[type] ??= []).push(listener),
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      ...extra,
    };
    new Function("window", screenBridgeSource())(win);
    return { win, posted, listeners, frames };
  };

  it("offers window.unframed.dials and reports readiness and first paint to a loopback parent", () => {
    const { win, posted, listeners, frames } = load("http://127.0.0.1:8787");
    expect(typeof win.unframed.dials).toBe("function");
    expect(posted.filter((entry) => entry.message.type.startsWith("unframed:screen:"))).toEqual([{ message: { type: "unframed:screen:ready", href: "http://127.0.0.1:4101/dashboard", route: "/dashboard", state: false }, to: "http://127.0.0.1:8787" }]);
    for (const listener of listeners.DOMContentLoaded ?? []) listener({});
    while (frames.length > 0) frames.shift()!();
    expect(posted.at(-1)).toEqual({ message: { type: "unframed:screen:paint", href: "http://127.0.0.1:4101/dashboard" }, to: "http://127.0.0.1:8787" });
  });

  it("carries the edit bridge, which says ready to the loopback parent and answers its hello", () => {
    const { posted, listeners, win } = load("http://127.0.0.1:8787");
    expect(posted.filter((entry) => entry.message.type === "unframed:edit:ready")).toEqual([{ message: { type: "unframed:edit:ready" }, to: "http://127.0.0.1:8787" }]);
    for (const listener of listeners.message ?? []) listener({ source: win.parent, origin: "http://127.0.0.1:8787", data: { type: "unframed:edit:hello" } });
    expect(posted.filter((entry) => entry.message.type === "unframed:edit:ready")).toHaveLength(2);
  });

  it("marks a cookie the page's script writes SameSite=None and Secure, so it holds in a frame on another site", () => {
    const written: string[] = [];
    class FakeDocument {}
    Object.defineProperty(FakeDocument.prototype, "cookie", { configurable: true, get: () => written.join("; "), set: (value: string) => void written.push(value) });
    const { win } = load("http://127.0.0.1:8787", { Document: FakeDocument });
    const doc = new win.Document();
    doc.cookie = "theme=dark; Path=/; SameSite=Lax";
    expect(written).toEqual(["theme=dark; Path=/; SameSite=None; Secure"]);
    expect(doc.cookie).toBe("theme=dark; Path=/; SameSite=None; Secure");
  });

  it("tells nothing to a parent that is not on this machine", () => {
    const { posted, listeners, frames } = load("https://evil.example");
    for (const listener of listeners.DOMContentLoaded ?? []) listener({});
    while (frames.length > 0) frames.shift()!();
    expect(posted).toEqual([]);
  });
});
