import { describe, expect, it } from "vitest";
import {
  bareOrigin,
  devShareHeaders,
  devShareOrigin,
  frameAncestors,
  httpsPeerOrigins,
  isTrustedPeerOrigin,
  loopbackGuard,
  previewContentSecurityPolicy,
  previewOriginForPage,
  previewShareHeaders,
  sharePeerOrigins,
} from "../src/index.ts";

const SHARE = "https://homebox.tail1234.ts.net:5173";
const LOOPBACK = "localhost:5173";

describe("dev share origin", () => {
  it.each([
    ["https://homebox.tail1234.ts.net:5173", "https://homebox.tail1234.ts.net:5173"],
    ["https://homebox.tail1234.ts.net:5173/", "https://homebox.tail1234.ts.net:5173"],
    ["https://homebox.tail1234.ts.net", "https://homebox.tail1234.ts.net"],
    ["https://homebox.tail1234.ts.net:443", "https://homebox.tail1234.ts.net"],
    ["  HTTPS://HomeBox.Tail1234.ts.net:5173 ", "https://homebox.tail1234.ts.net:5173"],
  ])("accepts %s as %s", (value, origin) => {
    expect(devShareOrigin(value)).toBe(origin);
  });

  it.each([
    undefined,
    "",
    " ",
    "http://homebox.tail1234.ts.net:5173",
    "homebox.tail1234.ts.net:5173",
    "https://homebox.tail1234.ts.net:5173/app",
    "https://homebox.tail1234.ts.net:5173/?a=1",
    "https://homebox.tail1234.ts.net:5173/#x",
    "https://user:pass@homebox.tail1234.ts.net:5173",
    "not a url",
  ])("refuses %j", (value) => {
    expect(devShareOrigin(value)).toBeUndefined();
  });
});

describe("dev share headers", () => {
  it("readdresses a request that came through the share origin to loopback", () => {
    expect(devShareHeaders({ shareOrigin: SHARE, loopbackHost: LOOPBACK, origin: SHARE, host: "homebox.tail1234.ts.net:5173" })).toEqual({
      origin: "http://localhost:5173",
      host: "localhost:5173",
    });
  });

  it("matches the share host and origin case-insensitively", () => {
    expect(
      devShareHeaders({ shareOrigin: SHARE, loopbackHost: LOOPBACK, origin: "https://HOMEBOX.tail1234.ts.net:5173", host: "HomeBox.tail1234.ts.net:5173" }),
    ).toEqual({ origin: "http://localhost:5173", host: "localhost:5173" });
  });

  it("readdresses the Host of a top-level navigation, which sends no Origin", () => {
    expect(devShareHeaders({ shareOrigin: SHARE, loopbackHost: LOOPBACK, host: "homebox.tail1234.ts.net:5173" })).toEqual({ host: "localhost:5173" });
  });

  it.each([
    ["https://evil.example", "homebox.tail1234.ts.net:5173"],
    ["http://homebox.tail1234.ts.net:5173", "homebox.tail1234.ts.net:5173"],
    ["https://homebox.tail1234.ts.net:5174", "homebox.tail1234.ts.net:5173"],
    ["https://homebox.tail1234.ts.net.evil.example:5173", "homebox.tail1234.ts.net:5173"],
    ["null", "homebox.tail1234.ts.net:5173"],
  ])("forwards a foreign Origin %s unchanged, so the guard still refuses it", (origin, host) => {
    const replaced = devShareHeaders({ shareOrigin: SHARE, loopbackHost: LOOPBACK, origin, host });
    expect(replaced.origin).toBeUndefined();
    expect(loopbackGuard({ origin: replaced.origin ?? origin, host: replaced.host ?? host }).allowed).toBe(false);
  });

  it.each(["evil.example", "homebox.tail1234.ts.net:5174", "homebox.tail1234.ts.net", "homebox.tail1234.ts.net.evil.example:5173"])(
    "forwards a foreign Host %s unchanged, so the guard still refuses it",
    (host) => {
      const replaced = devShareHeaders({ shareOrigin: SHARE, loopbackHost: LOOPBACK, origin: SHARE, host });
      expect(replaced.host).toBeUndefined();
      expect(loopbackGuard({ origin: replaced.origin ?? SHARE, host }).allowed).toBe(false);
    },
  );

  it("leaves loopback requests alone", () => {
    expect(devShareHeaders({ shareOrigin: SHARE, loopbackHost: LOOPBACK, origin: "http://localhost:5173", host: "localhost:5173" })).toEqual({});
  });
});

const PREVIEW = "https://homebox.tail1234.ts.net:18787";
const APP = "https://homebox.tail1234.ts.net:5173";

describe("preview share origin", () => {
  it("parses a bare http or https origin and refuses anything else", () => {
    expect(bareOrigin("https://homebox.tail1234.ts.net:18787")).toBe(PREVIEW);
    expect(bareOrigin("http://preview.example:9/")).toBe("http://preview.example:9");
    expect(bareOrigin("  HTTPS://HomeBox.Tail1234.ts.net:18787 ")).toBe(PREVIEW);
    for (const value of [undefined, "", "preview.example:9", "https://homebox.tail1234.ts.net:18787/p", "https://homebox.tail1234.ts.net:18787?a=1", "https://user:pass@homebox.tail1234.ts.net:18787", "not a url"]) {
      expect(bareOrigin(value), String(value)).toBeUndefined();
    }
    expect(devShareOrigin("http://preview.example:9")).toBeUndefined();
    expect(sharePeerOrigins(APP)).toEqual([APP]);
    expect(sharePeerOrigins("http://preview.example:9")).toEqual([]);
    expect(sharePeerOrigins(undefined)).toEqual([]);
  });

  it("keeps only exact bare https peers", () => {
    expect(httpsPeerOrigins([APP, "https://homebox.tail1234.ts.net:5173/", "https://other.example/x", "*", "https://evil.example; default-src *", APP])).toEqual([APP]);
    expect(frameAncestors([])).toBe("http://localhost:* http://127.0.0.1:*");
    expect(frameAncestors([APP, "https://nope.example/path"])).toBe(`http://localhost:* http://127.0.0.1:* ${APP}`);
    expect(previewContentSecurityPolicy([])).toBe(
      "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors http://localhost:* http://127.0.0.1:*",
    );
    expect(previewContentSecurityPolicy([APP])).toContain(`frame-ancestors http://localhost:* http://127.0.0.1:* ${APP}`);
    expect(frameAncestors(["*", "https://evil.example/x", "https://evil.example; default-src *"])).toBe("http://localhost:* http://127.0.0.1:*");
  });

  it("trusts the page's own origin, loopback http, and an exact peer", () => {
    const peers = [APP];
    expect(isTrustedPeerOrigin(APP, PREVIEW, peers)).toBe(true);
    expect(isTrustedPeerOrigin(PREVIEW, PREVIEW, peers)).toBe(true);
    expect(isTrustedPeerOrigin("http://localhost:5173", PREVIEW, peers)).toBe(true);
    expect(isTrustedPeerOrigin("http://127.0.0.1:5173", PREVIEW, [])).toBe(true);
    expect(isTrustedPeerOrigin("http://[::1]:5173", PREVIEW, [])).toBe(true);
    expect(isTrustedPeerOrigin("https://other.example", PREVIEW, peers)).toBe(false);
    expect(isTrustedPeerOrigin("https://localhost:5173", PREVIEW, [])).toBe(false);
    expect(isTrustedPeerOrigin("http://localhost.evil.example", PREVIEW, [])).toBe(false);
  });

  it("uses a configured preview origin only when the page is not loopback", () => {
    expect(previewOriginForPage("localhost", PREVIEW)).toBeUndefined();
    expect(previewOriginForPage("LOCALHOST", PREVIEW)).toBeUndefined();
    expect(previewOriginForPage("127.0.0.1", PREVIEW)).toBeUndefined();
    expect(previewOriginForPage("[::1]", PREVIEW)).toBeUndefined();
    expect(previewOriginForPage("::1", PREVIEW)).toBeUndefined();
    expect(previewOriginForPage("homebox.tail1234.ts.net", PREVIEW)).toBe(PREVIEW);
    expect(previewOriginForPage("homebox.tail1234.ts.net", undefined)).toBeUndefined();
    expect(previewOriginForPage("homebox.tail1234.ts.net", "https://homebox.tail1234.ts.net:18787/p")).toBeUndefined();
  });
});

describe("preview share headers", () => {
  const loopbackHost = "localhost:18787";

  it("readdresses the preview share host and origin to loopback", () => {
    expect(previewShareHeaders({ previewOrigin: PREVIEW, appOrigin: APP, loopbackHost, origin: PREVIEW, host: "homebox.tail1234.ts.net:18787" })).toEqual({
      origin: "http://localhost:18787",
      host: "localhost:18787",
    });
  });

  it("readdresses the app share origin, which an iframe navigation may send", () => {
    expect(previewShareHeaders({ previewOrigin: PREVIEW, appOrigin: APP, loopbackHost, origin: APP, host: "homebox.tail1234.ts.net:18787" })).toEqual({
      origin: "http://localhost:18787",
      host: "localhost:18787",
    });
    expect(loopbackGuard({ origin: "http://localhost:18787", host: "localhost:18787" }).allowed).toBe(true);
  });

  it("forwards a foreign host unchanged, so the guard still refuses it", () => {
    const replaced = previewShareHeaders({ previewOrigin: PREVIEW, appOrigin: APP, loopbackHost, origin: APP, host: "evil.example" });
    expect(replaced.host).toBeUndefined();
    expect(loopbackGuard({ origin: replaced.origin ?? APP, host: "evil.example" }).allowed).toBe(false);
  });

  it("forwards a foreign origin unchanged, so the guard still refuses it", () => {
    const replaced = previewShareHeaders({ previewOrigin: PREVIEW, appOrigin: APP, loopbackHost, origin: "https://evil.example", host: "homebox.tail1234.ts.net:18787" });
    expect(replaced.origin).toBeUndefined();
    expect(replaced.host).toBe("localhost:18787");
    expect(loopbackGuard({ origin: "https://evil.example", host: replaced.host }).allowed).toBe(false);
  });
});
