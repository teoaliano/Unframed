/**
 * `pnpm build [--out <dir>]`: the web and the engine as one flat, installable bundle.
 *
 *   package.json            name "unframed", the engine version, no dev tooling
 *   server/index.js         the fork entry, every workspace and inlinable package inside
 *   client/dist/            the built web
 *   client/package.json     a shim so an older shell's `npm ci && npm run build` in
 *   client/package-lock.json  client/ succeeds and leaves client/dist alone
 *   LICENSE, THIRD_PARTY_NOTICES
 */
import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { buildWeb, repoRoot } from "./buildWeb.ts";

/**
 * Runtime packages that cannot be inlined because they locate their own files on disk or
 * spawn binaries. Each one here must also be in the engine's dependencies: the bundle's
 * package.json takes its version from there.
 */
export const RUNTIME_DEPENDENCIES: ReadonlyArray<string> = ["@anthropic-ai/claude-agent-sdk"];

/** Build-time packages whose output ships in the bundle anyway (Tailwind's base styles). */
const SHIPPED_BUILD_PACKAGES = ["tailwindcss"];

const CLIENT_SHIM_NAME = "unframed-client";

const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, "utf8"));

/** Node's lookup: `node_modules/<name>` in `from` or any folder above it. */
const findPackage = (from: string, name: string): string | undefined => {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
};

type Notice = { name: string; version: string; license: string; text: string };

/** Every package that ends up in the bundle: the production closure of the engine and the web. */
const collectNotices = async (): Promise<Notice[]> => {
  const seen = new Map<string, Notice>();
  const visit = async (dir: string, includeSelf: boolean): Promise<void> => {
    const manifest = await readJson(join(dir, "package.json"));
    if (includeSelf) {
      const key = `${manifest.name}@${manifest.version}`;
      if (seen.has(key)) return;
      const licenseFile = (await readdir(dir)).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
      seen.set(key, {
        name: manifest.name,
        version: manifest.version,
        license: typeof manifest.license === "string" ? manifest.license : "see below",
        text: licenseFile ? (await readFile(join(dir, licenseFile), "utf8")).trim() : "",
      });
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith("@unframed/")) {
        await visit(join(repoRoot, "packages", dependency.slice("@unframed/".length)), false);
        continue;
      }
      const found = findPackage(dir, dependency);
      if (found) await visit(found, true);
    }
  };
  await visit(join(repoRoot, "packages/engine"), false);
  await visit(join(repoRoot, "packages/web"), false);
  for (const name of SHIPPED_BUILD_PACKAGES) {
    const found = findPackage(join(repoRoot, "packages/web"), name);
    if (found) await visit(found, true);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const noticesText = async (): Promise<string> => {
  const base = (await readFile(join(repoRoot, "THIRD_PARTY_NOTICES"), "utf8")).trimEnd();
  const packages = (await collectNotices())
    .map((notice) =>
      [
        "--------------------------------------------------------------------------------",
        `${notice.name} ${notice.version} (${notice.license})`,
        "--------------------------------------------------------------------------------",
        "",
        notice.text || `Licensed under ${notice.license}.`,
      ].join("\n"),
    )
    .join("\n\n");
  return `${base}\n\nThe bundle also contains these packages:\n\n${packages}\n`;
};

export const buildBundle = async (out: string, env: Record<string, string | undefined> = {}): Promise<void> => {
  const engineManifest = await readJson(join(repoRoot, "packages/engine/package.json"));
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "server"), { recursive: true });

  await buildWeb(join(out, "client", "dist"), env);

  await build({
    entryPoints: [join(repoRoot, "packages/engine/src/main.ts")],
    outfile: join(out, "server", "index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    define: { __UNFRAMED_BUNDLE__: "true" },
    // `ws` tries these optional speed-ups inside a try and works without them.
    external: [...RUNTIME_DEPENDENCIES, "bufferutil", "utf-8-validate"],
    // Inlined CommonJS packages still call require() for Node's own modules.
    banner: { js: 'import { createRequire as __unframedCreateRequire } from "node:module";\nconst require = __unframedCreateRequire(import.meta.url);' },
  });

  const dependencies: Record<string, string> = {};
  for (const name of RUNTIME_DEPENDENCIES) dependencies[name] = engineManifest.dependencies[name];
  await writeFile(
    join(out, "package.json"),
    `${JSON.stringify(
      { name: "unframed", version: engineManifest.version, type: "module", main: "server/index.js", dependencies },
      null,
      2,
    )}\n`,
  );

  const shim = {
    name: CLIENT_SHIM_NAME,
    version: engineManifest.version,
    private: true,
    description: "Compatibility shim: the client is already built into client/dist.",
    scripts: { build: "exit 0" },
  };
  await writeFile(join(out, "client", "package.json"), `${JSON.stringify(shim, null, 2)}\n`);
  const lock = {
    name: CLIENT_SHIM_NAME,
    version: engineManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: CLIENT_SHIM_NAME, version: engineManifest.version } },
  };
  await writeFile(join(out, "client", "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);

  const license = join(repoRoot, "LICENSE");
  if (existsSync(license)) await copyFile(license, join(out, "LICENSE"));
  else process.stderr.write("  build: there is no LICENSE at the repository root, so the bundle has none\n");
  await writeFile(join(out, "THIRD_PARTY_NOTICES"), await noticesText());
};

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const outFlag = process.argv.indexOf("--out");
  const out = resolve(outFlag >= 0 && process.argv[outFlag + 1] ? process.argv[outFlag + 1]! : join(repoRoot, "dist"));
  await buildBundle(out);
  process.stdout.write(`  bundle: ${out}\n`);
}
