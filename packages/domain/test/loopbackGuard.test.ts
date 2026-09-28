import { describe, expect, it } from "vitest";
import { loopbackGuard } from "../src/index.ts";

const SAME_MACHINE = { allowed: false, status: 403, error: "Unframed answers only same-machine requests." };
const LOCALHOST = { allowed: false, status: 403, error: "Unframed answers only requests addressed to localhost." };
const ALLOWED = { allowed: true };

describe("loopback guard", () => {
  it.each([
    ["http://localhost", "localhost:8787"],
    ["http://localhost:5173", "localhost:5173"],
    ["https://localhost:5173", "localhost:5173"],
    ["http://127.0.0.1:8787", "127.0.0.1:8787"],
    ["http://127.0.0.1", "127.0.0.1"],
    ["http://[::1]:8787", "[::1]:8787"],
    ["http://[::1]", "[::1]"],
    ["http://LOCALHOST:8787", "LOCALHOST:8787"],
    ["HTTP://LocalHost:1", "localhost"],
  ])("allows loopback origin %s with host %s", (origin, host) => {
    expect(loopbackGuard({ origin, host })).toEqual(ALLOWED);
  });

  it("allows an absent Origin with a loopback Host (a top-level navigation)", () => {
    expect(loopbackGuard({ host: "localhost:8787" })).toEqual(ALLOWED);
    expect(loopbackGuard({ origin: undefined, host: "127.0.0.1:8787" })).toEqual(ALLOWED);
  });

  it.each([
    "https://evil.example",
    "http://localhost.evil.example",
    "http://localhost.evil.example:8787",
    "http://127.0.0.2:8787",
    "http://127.0.0.1.nip.io",
    "http://localhost:80a",
    "http://localhost:",
    "http://localhost:8787/",
    "http://localhost:8787/path",
    "file://",
    "null",
    "",
    "ws://localhost:8787",
    "http://[::2]:8787",
  ])("refuses origin %j with the same-machine message", (origin) => {
    expect(loopbackGuard({ origin, host: "localhost:8787" })).toEqual(SAME_MACHINE);
  });

  it.each([
    "localhost.evil.example",
    "localhost.evil.example:8787",
    "evil.example",
    "127.0.0.2:8787",
    "localhost:abc",
    "localhost:",
    "localhost:8787 ",
    "0.0.0.0:8787",
    "[::2]:8787",
    "",
  ])("refuses host %j with the localhost message", (host) => {
    expect(loopbackGuard({ host })).toEqual(LOCALHOST);
  });

  it("refuses an absent Host", () => {
    expect(loopbackGuard({})).toEqual(LOCALHOST);
    expect(loopbackGuard({ origin: "http://localhost:5173" })).toEqual(LOCALHOST);
  });

  it("checks Origin before Host", () => {
    expect(loopbackGuard({ origin: "https://evil.example", host: "evil.example" })).toEqual(SAME_MACHINE);
  });
});
