import { describe, expect, it } from "vitest";
import { createShareRegistry, SHARE_TTL_MS, shareMime, shareTokenOf, tokenFromBytes } from "../src/index.ts";

const bytes = (fill: number) => new Uint8Array(32).fill(fill);

describe("share tokens", () => {
  it("are 32 random bytes as 43 base64url characters", () => {
    const tokens = [bytes(0), bytes(255), bytes(0xfb), Uint8Array.from({ length: 32 }, (_, index) => index * 8)].map(tokenFromBytes);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenFromBytes(bytes(0))).toBe("A".repeat(43));
    expect(tokenFromBytes(bytes(255))).toBe(`${"_".repeat(42)}8`);
    expect(tokenFromBytes(bytes(0xfb))).toBe(Buffer.from(bytes(0xfb)).toString("base64url"));
  });

  it("refuses anything but 32 bytes", () => {
    expect(() => tokenFromBytes(new Uint8Array(31))).toThrow();
  });

  it.each([
    [`/share/${"a".repeat(43)}`, "a".repeat(43)],
    [`/share/${"A-_9".repeat(10)}xyz`, `${"A-_9".repeat(10)}xyz`],
    [`/share/${"a".repeat(42)}`, undefined],
    [`/share/${"a".repeat(44)}`, undefined],
    [`/share/${"a".repeat(42)}=`, undefined],
    [`/share/${"a".repeat(43)}/`, undefined],
    [`/share/${"a".repeat(43)}?x=1`, undefined],
    [`/share/%61${"a".repeat(40)}`, undefined],
    [`//share/${"a".repeat(43)}`, undefined],
    [`/api/share/${"a".repeat(43)}`, undefined],
    ["/", undefined],
  ])("match the raw request path %s exactly", (path, token) => {
    expect(shareTokenOf(path)).toBe(token);
  });

  it.each([
    ["clip.mp4", "video/mp4"],
    ["clip.MOV", "video/quicktime"],
    ["a.b.webm", "video/webm"],
    ["clip.m4v", "application/octet-stream"],
  ])("serve %s as %s", (file, mime) => {
    expect(shareMime(file)).toBe(mime);
  });
});

describe("the share registry", () => {
  it("answers a live registration, and nothing once it expires after the TTL", () => {
    const registry = createShareRegistry<string>(1000);
    registry.add("t1", { file: "/tmp/one.bin", mime: "video/mp4" }, 5000);
    expect(registry.get("t1", 5999)).toEqual({ file: "/tmp/one.bin", mime: "video/mp4", expiresAt: 6000 });
    expect(registry.get("t1", 6000)).toBeUndefined();
    expect(registry.get("nope", 5000)).toBeUndefined();
  });

  it("lists the expired registrations for the expiry check", () => {
    const registry = createShareRegistry<string>(1000);
    registry.add("early", { file: "a", mime: "video/mp4" }, 0);
    registry.add("late", { file: "b", mime: "video/mp4" }, 500);
    expect(registry.expired(999)).toEqual([]);
    expect(registry.expired(1000)).toEqual(["early"]);
    expect(registry.expired(1500)).toEqual(["early", "late"]);
  });

  it("needs the tunnel only while a registration lives", () => {
    const registry = createShareRegistry<string>(SHARE_TTL_MS);
    expect(registry.tunnelNeeded()).toBe(false);
    registry.add("a", { file: "a", mime: "video/mp4" }, 0);
    registry.add("b", { file: "b", mime: "video/mp4" }, 0);
    expect(registry.tunnelNeeded()).toBe(true);
    expect(registry.remove("a")).toMatchObject({ file: "a" });
    expect(registry.tunnelNeeded()).toBe(true);
    expect(registry.remove("a")).toBeUndefined();
    registry.remove("b");
    expect(registry.tunnelNeeded()).toBe(false);
  });

  it("keeps a 30 minute TTL by default", () => {
    expect(SHARE_TTL_MS).toBe(30 * 60 * 1000);
  });
});
