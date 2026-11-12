import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "./buildWeb.ts";

const APP_NAME = "Unframed Dev";
const APP_ID = "com.teoaliano.unframed.dev";
const TEAM = "N2X3SV5FDD";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.error("pnpm dev:app builds the dev app for Apple silicon Macs only.");
  process.exit(1);
}

const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, stdio: "inherit" });

const work = mkdtempSync(join(tmpdir(), "unframed-dev-app-"));
const engineDir = join(work, "engine");
const shellDir = join(work, "desktop");

try {
  if (!process.env.TLDRAW_LICENSE_KEY) console.warn("TLDRAW_LICENSE_KEY is not set: the dev app's canvas shows tldraw's license notice.");

  console.log("Building the engine bundle from this checkout");
  run(process.execPath, [join(repoRoot, "scripts", "build.ts"), "--out", engineDir], repoRoot);
  run("npm", ["pack", "--silent", "--pack-destination", work], engineDir);
  const tarball = readdirSync(work).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack wrote no tarball.");

  console.log("Installing the desktop shell with that bundle");
  const desktop = join(repoRoot, "apps", "desktop");
  cpSync(desktop, shellDir, { recursive: true, filter: (from) => !/[/\\](node_modules|dist)([/\\]|$)/.test(from.slice(desktop.length)) });
  run("npm", ["ci", "--no-audit", "--no-fund"], shellDir);
  run("npm", ["install", "--no-save", "--no-audit", "--no-fund", join(work, tarball)], shellDir);

  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  const signed = identities.includes(TEAM);
  if (!signed) console.warn("No Developer ID certificate for the team in the keychain: the dev app is signed ad hoc and runs on this Mac only.");

  const manifestPath = join(shellDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { afterAllArtifactBuild: _notarizeDmg, publish: _publish, ...build } = manifest.build;
  manifest.build = {
    ...build,
    appId: APP_ID,
    productName: APP_NAME,
    extraMetadata: { unframedChannel: "dev" },
    mac: { ...build.mac, notarize: false, ...(signed ? {} : { identity: null, hardenedRuntime: false }) },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Packaging ${APP_NAME}`);
  run("npx", ["electron-builder", "--mac", "--arm64", "--dir", "--publish", "never"], shellDir);
  const built = join(shellDir, "dist", "mac-arm64", `${APP_NAME}.app`);
  if (!existsSync(built)) throw new Error(`electron-builder did not write ${built}.`);
  if (!signed) run("codesign", ["--force", "--deep", "--sign", "-", built], shellDir);

  const installed = join("/Applications", `${APP_NAME}.app`);
  execFileSync("osascript", ["-e", `if application "${APP_NAME}" is running then tell application "${APP_NAME}" to quit`], { stdio: "ignore" });
  rmSync(installed, { recursive: true, force: true });
  run("ditto", [built, installed], work);
  console.log(`Installed ${installed}`);
  if (process.argv.includes("--open")) run("open", [installed], work);
} finally {
  rmSync(work, { recursive: true, force: true });
}
