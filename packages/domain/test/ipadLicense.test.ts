import { describe, expect, it } from "vitest";
import { hostCovered, licenseHosts } from "../src/index.ts";

const key = (payload: unknown, prefix = "tldraw-hobby"): string => `${prefix}/${btoa(JSON.stringify(payload))}.c2lnbmF0dXJl`;

const NAME = "mbp-aliano.local";

describe("licenseHosts", () => {
  it("reads the host list out of a well-formed key", () => {
    expect(licenseHosts(key(["id-1", ["unframed.design", NAME], 9, "2027-01-01"]))).toEqual(["unframed.design", NAME]);
  });

  it("keeps the hosts of a key whose flags do not include the native bit", () => {
    expect(licenseHosts(key(["id-1", [NAME], 1 | 8, "2027-01-01"]))).toEqual([NAME]);
  });

  it("answers no hosts for a native key, whose entries match a protocol and not a host", () => {
    expect(licenseHosts(key(["id-1", [NAME, "app-bundle:"], 1 | 32, "2027-01-01"]))).toEqual([]);
  });

  it("ignores zero-width characters and line breaks, as tldraw does", () => {
    const clean = key(["id-1", [NAME], 9, "2027-01-01"]);
    const dirty = `${clean.slice(0, 10)}​\n${clean.slice(10)}`;
    expect(licenseHosts(dirty)).toEqual([NAME]);
  });

  it.each([
    ["an empty key", ""],
    ["blank space", "   "],
    ["no prefix", `${btoa(JSON.stringify(["id", [NAME], 9]))}.sig`],
    ["a foreign prefix", key(["id", [NAME], 9], "someone-else")],
    ["no payload", "tldraw-hobby/.sig"],
    ["payload that is not base64", "tldraw-hobby/not base64!!.sig"],
    ["payload that is not JSON", `tldraw-hobby/${btoa("not json")}.sig`],
    ["a payload that is not an array", key({ hosts: [NAME] })],
    ["a host list that is not an array", key(["id", NAME, 9])],
  ])("answers no hosts for %s", (_case, value) => {
    expect(licenseHosts(value)).toEqual([]);
  });

  it("keeps only the strings in a host list", () => {
    expect(licenseHosts(key(["id", [NAME, 7, null], 9]))).toEqual([NAME]);
  });
});

describe("hostCovered", () => {
  it.each([
    ["an exact entry", [NAME], "MBP-ALIANO.local"],
    ["an entry with space around it", [` ${NAME} `], NAME],
    ["an entry in another case", ["MBP-Aliano.Local"], NAME],
    ["www on the name", ["example.com"], "www.example.com"],
    ["www on the entry", ["www.example.com"], "example.com"],
    ["a star", ["*"], NAME],
    ["an end-anchored glob", ["*.local"], NAME],
    ["a glob against the www name", ["*.example.com"], "example.com"],
    ["a glob that matches more than it should, as tldraw's does", ["foo*.local"], "barfoox.local"],
  ])("covers %s", (_case, hosts, name) => {
    expect(hostCovered(hosts, name)).toBe(true);
  });

  it.each([
    ["an empty list", [], NAME],
    ["another name", ["unframed.design"], NAME],
    ["a glob that is anchored at the end", ["*.local"], "mbp-aliano.localhost"],
    ["a glob whose dots are literal", ["*.local"], "mbp-alianoXlocal"],
    ["an entry that is part of the name", ["aliano.local"], NAME],
  ])("does not cover %s", (_case, hosts, name) => {
    expect(hostCovered(hosts, name)).toBe(false);
  });
});
