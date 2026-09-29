/**
 * Where a Chromium browser may be on this machine (spec 09), in the order they are tried:
 * `UNFRAMED_CHROME_PATH`, the installed browsers of the platform, then the headless shells
 * puppeteer and HyperFrames cache, newest version first. The first that exists wins; the
 * engine checks existence, this only lists.
 */

export interface ChromeSearch {
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  /** The folder names directly inside `dir` (the cache's version folders), `[]` when it has none. */
  readonly versionsIn: (dir: string) => ReadonlyArray<string>;
}

const MAC_APPS = [
  "Google Chrome.app/Contents/MacOS/Google Chrome",
  "Chromium.app/Contents/MacOS/Chromium",
  "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "Brave Browser.app/Contents/MacOS/Brave Browser",
  "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
];

const WINDOWS_ROOTS = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"];
const WINDOWS_APPS = [
  "Google\\Chrome\\Application\\chrome.exe",
  "Microsoft\\Edge\\Application\\msedge.exe",
  "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  "Chromium\\Application\\chrome.exe",
];

const LINUX_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];
const LINUX_DIRS = ["/usr/bin", "/usr/local/bin", "/snap/bin", "/opt/google/chrome"];

const SHELL_FOLDERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  darwin: ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"],
  linux: ["chrome-headless-shell-linux64"],
  win32: ["chrome-headless-shell-win64"],
};

/** Version folders newest first: numbers compare as numbers, so 131.0.10 beats 131.0.9. */
const byVersionDescending = (a: string, b: string): number => {
  const parts = (name: string) => name.split(/(\d+)/).filter((part) => part !== "");
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    if (x === y) continue;
    const bothNumbers = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (bothNumbers) return Number(y) - Number(x);
    return x < y ? 1 : -1;
  }
  return 0;
};

export const chromeCandidates = (search: ChromeSearch): string[] => {
  const windows = search.platform === "win32";
  const sep = windows ? "\\" : "/";
  const join = (...parts: string[]) => parts.join(sep);
  const candidates: string[] = [];
  const explicit = search.env.UNFRAMED_CHROME_PATH?.trim();
  if (explicit) candidates.push(explicit);

  if (search.platform === "darwin") {
    for (const root of ["/Applications", `${search.home}/Applications`]) for (const app of MAC_APPS) candidates.push(`${root}/${app}`);
  } else if (windows) {
    for (const variable of WINDOWS_ROOTS) {
      const root = search.env[variable];
      if (root) for (const app of WINDOWS_APPS) candidates.push(`${root}\\${app}`);
    }
  } else {
    for (const name of LINUX_NAMES) for (const dir of LINUX_DIRS) candidates.push(`${dir}/${name}`);
  }

  const folders = SHELL_FOLDERS[search.platform] ?? SHELL_FOLDERS.linux!;
  const binary = windows ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  for (const cache of [join(search.home, ".cache", "puppeteer", "chrome-headless-shell"), join(search.home, ".cache", "hyperframes", "chrome", "chrome-headless-shell")]) {
    for (const version of [...search.versionsIn(cache)].sort(byVersionDescending)) {
      for (const folder of folders) candidates.push(join(cache, version, folder, binary));
    }
  }
  return candidates;
};

export const NO_CHROME_RENDER_MESSAGE =
  "Rendering needs a Chromium browser on this computer: Google Chrome, Chromium, Edge or Brave. Install one, or point UNFRAMED_CHROME_PATH at its binary, and render again.";

export const NO_CHROME_PREVIEW_MESSAGE = "No Chrome, Chromium, Edge or Brave was found on this machine, so the agent cannot open a preview.";
