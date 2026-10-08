import { describe, expect, it } from "vitest";
import { devShareHeaders, devShareOrigin, loopbackGuard } from "../src/index.ts";

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
