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
    expect(upstreamRequestHeaders(base, { upstreamPort: 3000, path: "/dashboard", upgrade: false })).toEqual(base);
  });

  it.each([
    ["/_next/static/chunk.js", false],
    ["/_next/webpack-hmr?page=/", true],
    ["/__nextjs_original-stack-frames", false],
    ["/?token=abc", true],
  ])("rewrites Origin to localhost on %j (upgrade %j)", (path, upgrade) => {
    expect(upstreamRequestHeaders(base, { upstreamPort: 3000, path, upgrade })).toEqual({ ...base, origin: "http://localhost:3000" });
  });

  it("adds no Origin where the browser sent none", () => {
    const { origin: _origin, ...noOrigin } = base;
    expect(upstreamRequestHeaders(noOrigin, { upstreamPort: 3000, path: "/_next/x", upgrade: true })).toEqual(noOrigin);
  });

  it("asks for an unencoded body when the request accepts HTML", () => {
    const headers = { ...base, accept: "text/html,application/xhtml+xml", "accept-encoding": "gzip, br" };
    expect(upstreamRequestHeaders(headers, { upstreamPort: 3000, path: "/", upgrade: false })["accept-encoding"]).toBe("identity");
    expect(upstreamRequestHeaders({ ...base, "accept-encoding": "gzip" }, { upstreamPort: 3000, path: "/app.js", upgrade: false })["accept-encoding"]).toBe("gzip");
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
      "set-cookie": ["a=1; SameSite=Lax"],
    });
    expect(answered.nonce).toBeUndefined();
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
  const load = (ancestor: string | undefined) => {
    const posted: Array<{ message: any; to: string }> = [];
    const listeners: Record<string, Array<(event: any) => void>> = {};
    const frames: Array<() => void> = [];
    const parent = { postMessage: (message: unknown, to: string) => posted.push({ message, to }) };
    const win: any = {
      parent,
      location: { origin: "http://127.0.0.1:4101", href: "http://127.0.0.1:4101/dashboard", ancestorOrigins: ancestor === undefined ? [] : [ancestor] },
      document: { readyState: "loading", referrer: "", head: { appendChild: () => undefined }, createElement: () => ({ src: "" }) },
      console: { error: () => undefined },
      addEventListener: (type: string, listener: (event: any) => void) => (listeners[type] ??= []).push(listener),
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
    };
    new Function("window", screenBridgeSource())(win);
    return { win, posted, listeners, frames };
  };

  it("offers window.unframed.dials and reports readiness and first paint to a loopback parent", () => {
    const { win, posted, listeners, frames } = load("http://127.0.0.1:8787");
    expect(typeof win.unframed.dials).toBe("function");
    expect(posted).toEqual([{ message: { type: "unframed:screen:ready", href: "http://127.0.0.1:4101/dashboard" }, to: "http://127.0.0.1:8787" }]);
    for (const listener of listeners.DOMContentLoaded ?? []) listener({});
    while (frames.length > 0) frames.shift()!();
    expect(posted.at(-1)).toEqual({ message: { type: "unframed:screen:paint", href: "http://127.0.0.1:4101/dashboard" }, to: "http://127.0.0.1:8787" });
  });

  it("tells nothing to a parent that is not on this machine", () => {
    const { posted, listeners, frames } = load("https://evil.example");
    for (const listener of listeners.DOMContentLoaded ?? []) listener({});
    while (frames.length > 0) frames.shift()!();
    expect(posted).toEqual([]);
  });
});
