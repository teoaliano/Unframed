import { describe, expect, it } from "vitest";
import { chromeCandidates } from "../../src/index.ts";

const noCaches = () => [];

describe("the Chrome candidate list", () => {
  it("tries UNFRAMED_CHROME_PATH first, then macOS's installed browsers under /Applications and ~/Applications", () => {
    const list = chromeCandidates({ platform: "darwin", env: { UNFRAMED_CHROME_PATH: " /opt/my/chrome " }, home: "/Users/me", versionsIn: noCaches });
    expect(list).toEqual([
      "/opt/my/chrome",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Users/me/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Users/me/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Users/me/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Users/me/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ]);
  });

  it("leaves UNFRAMED_CHROME_PATH out when it is unset or blank", () => {
    const list = chromeCandidates({ platform: "darwin", env: { UNFRAMED_CHROME_PATH: "  " }, home: "/Users/me", versionsIn: noCaches });
    expect(list[0]).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  it("looks under each Windows program folder that is set", () => {
    const list = chromeCandidates({
      platform: "win32",
      env: { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
      home: "C:\\Users\\me",
      versionsIn: noCaches,
    });
    expect(list).toEqual([
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "C:\\Program Files\\Chromium\\Application\\chrome.exe",
      "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Users\\me\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "C:\\Users\\me\\AppData\\Local\\Chromium\\Application\\chrome.exe",
    ]);
  });

  it("looks for each Linux browser name under the four binary folders", () => {
    const list = chromeCandidates({ platform: "linux", env: {}, home: "/home/me", versionsIn: noCaches });
    expect(list).toHaveLength(24);
    expect(list.slice(0, 5)).toEqual(["/usr/bin/google-chrome", "/usr/local/bin/google-chrome", "/snap/bin/google-chrome", "/opt/google/chrome/google-chrome", "/usr/bin/google-chrome-stable"]);
    expect(list.at(-1)).toBe("/opt/google/chrome/brave-browser");
  });

  it("ends with the headless shell caches, puppeteer's then HyperFrames', newest version first", () => {
    const versions: Record<string, string[]> = {
      "/Users/me/.cache/puppeteer/chrome-headless-shell": ["mac_arm-131.0.6778.9", "mac_arm-131.0.6778.85", "mac_arm-129.0.1"],
      "/Users/me/.cache/hyperframes/chrome/chrome-headless-shell": ["mac_arm-140.0.1"],
    };
    const list = chromeCandidates({ platform: "darwin", env: {}, home: "/Users/me", versionsIn: (dir) => versions[dir] ?? [] });
    const shells = list.filter((path) => path.includes(".cache"));
    expect(list.slice(-shells.length)).toEqual(shells);
    expect(shells).toEqual([
      "/Users/me/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.85/chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "/Users/me/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.85/chrome-headless-shell-mac-x64/chrome-headless-shell",
      "/Users/me/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.9/chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "/Users/me/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.9/chrome-headless-shell-mac-x64/chrome-headless-shell",
      "/Users/me/.cache/puppeteer/chrome-headless-shell/mac_arm-129.0.1/chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "/Users/me/.cache/puppeteer/chrome-headless-shell/mac_arm-129.0.1/chrome-headless-shell-mac-x64/chrome-headless-shell",
      "/Users/me/.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-140.0.1/chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "/Users/me/.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-140.0.1/chrome-headless-shell-mac-x64/chrome-headless-shell",
    ]);
  });

  it("names each platform's headless shell folder and binary", () => {
    const one = (dir: string) => (dir.includes("puppeteer") ? ["1.0.0"] : []);
    expect(chromeCandidates({ platform: "linux", env: {}, home: "/home/me", versionsIn: one }).at(-1)).toBe(
      "/home/me/.cache/puppeteer/chrome-headless-shell/1.0.0/chrome-headless-shell-linux64/chrome-headless-shell",
    );
    expect(chromeCandidates({ platform: "win32", env: {}, home: "C:\\Users\\me", versionsIn: one }).at(-1)).toBe(
      "C:\\Users\\me\\.cache\\puppeteer\\chrome-headless-shell\\1.0.0\\chrome-headless-shell-win64\\chrome-headless-shell.exe",
    );
  });
});
