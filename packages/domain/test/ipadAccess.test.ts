import { describe, expect, it } from "vitest";
import { allowedForDevice, availability, deviceAddress, deviceGuard, deviceNameFor, followTabs, isPrivateAddress, leafNeedsRenewal } from "../src/index.ts";

const NAME = "mbp-aliano.local";
const PORT = 18790;
const HOSTS = ["unframed.design", NAME];
const COVERED = { platform: "darwin", hosted: true, localName: NAME, hosts: HOSTS } as const;

describe("availability", () => {
  it("is available on a hosted Mac whose key lists the local name", () => {
    expect(availability(COVERED)).toEqual({ available: true });
  });

  it.each([
    ["not_macos", { ...COVERED, platform: "linux" }],
    ["not_macos", { ...COVERED, platform: "win32" }],
    ["not_hosted", { ...COVERED, hosted: false }],
    ["no_local_name", { ...COVERED, localName: undefined }],
    ["no_local_name", { ...COVERED, localName: "" }],
    ["host_not_covered", { ...COVERED, hosts: ["unframed.design"] }],
    ["host_not_covered", { ...COVERED, hosts: [] }],
  ])("answers %s when that condition fails", (reason, input) => {
    expect(availability(input)).toEqual({ available: false, reason });
  });
});

describe("isPrivateAddress", () => {
  it.each(["10.0.0.0", "10.255.255.255", "172.16.0.0", "172.31.255.255", "192.168.0.0", "192.168.1.136", "192.168.255.255"])("accepts %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "9.255.255.255",
    "11.0.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "192.167.255.255",
    "192.169.0.0",
    "127.0.0.1",
    "169.254.1.1",
    "0.0.0.0",
    "8.8.8.8",
    "::1",
    "fe80::1",
    "::ffff:192.168.1.136",
    "192.168.1",
    "192.168.1.256",
    "not an address",
    "",
  ])("refuses %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("deviceGuard", () => {
  const guard = (headers: { host?: string | undefined; origin?: string | undefined }) => deviceGuard({ ...headers, localName: NAME, port: PORT });
  const WRONG_HOST = { allowed: false, status: 403, error: `Open Unframed at https://${NAME}:${PORT}.` };
  const WRONG_ORIGIN = { allowed: false, status: 403, error: "Unframed answers only same-machine requests." };

  it("allows the local name at the iPad port with no Origin", () => {
    expect(guard({ host: `${NAME}:${PORT}` })).toEqual({ allowed: true });
  });

  it("allows its own Origin, whatever the case of either", () => {
    expect(guard({ host: `MBP-ALIANO.local:${PORT}`, origin: `https://MBP-Aliano.Local:${PORT}` })).toEqual({ allowed: true });
  });

  it.each([
    ["an address", `192.168.1.136:${PORT}`],
    ["another name", `unframed.design:${PORT}`],
    ["the name on another port", `${NAME}:8787`],
    ["the name with no port", NAME],
    ["loopback", `localhost:${PORT}`],
    ["a name that ends in the local name", `evil.${NAME}:${PORT}`],
  ])("refuses %s as the Host", (_case, host) => {
    expect(guard({ host })).toEqual(WRONG_HOST);
  });

  it("refuses a missing Host", () => {
    expect(guard({})).toEqual(WRONG_HOST);
  });

  it.each([`https://evil.example`, `http://${NAME}:${PORT}`, `https://${NAME}:8787`, "null", ""])("refuses the foreign Origin %s", (origin) => {
    expect(guard({ host: `${NAME}:${PORT}`, origin })).toEqual(WRONG_ORIGIN);
  });

  it("builds the address the person opens", () => {
    expect(deviceAddress(NAME, PORT)).toBe(`https://${NAME}:${PORT}`);
  });
});

describe("deviceNameFor", () => {
  const date = new Date("2026-11-04T10:00:00Z");

  it.each([
    ["iPad", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15"],
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"],
    ["Browser", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"],
    ["Browser", ""],
  ])("names a %s by its user agent, with the pairing date", (kind, userAgent) => {
    expect(deviceNameFor(userAgent, date)).toBe(`${kind} (4 Nov 2026)`);
  });
});

describe("leafNeedsRenewal", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  const inDays = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  it("keeps a leaf with 31 days left for this Mac", () => {
    expect(leafNeedsRenewal({ san: NAME, notAfter: inDays(31) }, NAME, now)).toBe(false);
  });

  it("renews a leaf with 29 days left", () => {
    expect(leafNeedsRenewal({ san: NAME, notAfter: inDays(29) }, NAME, now)).toBe(true);
  });

  it("renews a leaf that has expired", () => {
    expect(leafNeedsRenewal({ san: NAME, notAfter: inDays(-1) }, NAME, now)).toBe(true);
  });

  it("renews a leaf whose name is not this Mac's any more", () => {
    expect(leafNeedsRenewal({ san: "old-mac.local", notAfter: inDays(300) }, NAME, now)).toBe(true);
  });

  it("reads the name case-insensitively", () => {
    expect(leafNeedsRenewal({ san: "MBP-ALIANO.local", notAfter: inDays(300) }, NAME, now)).toBe(false);
  });
});

describe("allowedForDevice", () => {
  it.each([
    "files.reveal",
    "files.path",
    "settings.pickFolder",
    "oauth.start",
    "oauth.cancel",
    "agentConnections.create",
    "agentConnections.revoke",
    "ipad.pairStart",
    "ipad.devices",
    "ipad.revoke",
    "ipad.exportProfile",
    "ipad.setAvailability",
  ])("refuses %s", (method) => {
    expect(allowedForDevice(method)).toBe(false);
  });

  it.each([
    "ipad.status",
    "server.health",
    "settings.get",
    "run.image",
    "run.text",
    "orchestration.dispatchCommand",
    "projects.list",
    "files.copy",
    "agentConnections.list",
    "preferences.get",
  ])("allows %s", (method) => {
    expect(allowedForDevice(method)).toBe(true);
  });

  it.each([{ ipadAccess: "on" }, { ipadPort: "18791" }, { imageModel: "openai/gpt-image-2", ipadAccess: "" }])("refuses a settings write of %o", (patch) => {
    expect(allowedForDevice("settings.update", patch)).toBe(false);
  });

  it("allows a settings write that leaves the iPad variables alone", () => {
    expect(allowedForDevice("settings.update", { imageModel: "openai/gpt-image-2" })).toBe(true);
  });

  it.each(["project.tabs", "project.active"])("refuses a preferences write of %s", (key) => {
    expect(allowedForDevice("preferences.set", { key, value: { order: [] } })).toBe(false);
  });

  it("allows a preferences write of any other key", () => {
    expect(allowedForDevice("preferences.set", { key: "canvas.theme", value: "dark" })).toBe(true);
  });
});

describe("followTabs", () => {
  it("starts out following the Mac", () => {
    expect(followTabs(undefined, { type: "macActive", project: "alpha" })).toEqual({ kind: "following" });
  });

  it("detaches to the project chosen on the device", () => {
    expect(followTabs({ kind: "following" }, { type: "localChoice", project: "beta" })).toEqual({ kind: "detached", project: "beta" });
  });

  it("stays detached while the device chooses again", () => {
    expect(followTabs({ kind: "detached", project: "beta" }, { type: "localChoice", project: "gamma" })).toEqual({ kind: "detached", project: "gamma" });
  });

  it("follows again on the Mac's next tab switch", () => {
    expect(followTabs({ kind: "detached", project: "beta" }, { type: "macActive", project: "alpha" })).toEqual({ kind: "following" });
  });

  it("keeps following when the Mac switches while the device follows", () => {
    expect(followTabs({ kind: "following" }, { type: "macActive", project: "alpha" })).toEqual({ kind: "following" });
  });
});
