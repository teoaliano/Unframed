/**
 * The published bundle, built by `pnpm build`. CI's smoke step points
 * `UNFRAMED_BUNDLE_DIR` at the bundle it just built; otherwise these tests build one.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBundle } from "../../../scripts/build.ts";
import { makeTempDir, repoRoot, startEngine } from "./harness.ts";

const execFileAsync = promisify(execFile);

/** npm, killed well before its test times out, so no install outlives the test that started it. */
const npm = (args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) =>
  execFileAsync("npm", args, { ...options, timeout: 90_000, killSignal: "SIGKILL" }).catch(
    (error: { stderr?: string; message: string }) => {
      throw new Error(`npm ${args.join(" ")} failed: ${error.stderr ?? error.message}`);
    },
  );

const listFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
};

const hashTree = async (dir: string): Promise<Record<string, string>> => {
  const hashes: Record<string, string> = {};
  for (const file of await listFiles(dir)) {
    hashes[file] = createHash("sha256").update(await readFile(join(dir, file))).digest("hex");
  }
  return hashes;
};

const servedAssets = async (engine: Awaited<ReturnType<typeof startEngine>>): Promise<string> => {
  const index = await engine.request("/");
  const assets = [...index.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]!);
  expect(assets.length).toBeGreaterThan(0);
  let text = index.text;
  for (const asset of assets) {
    const response = await engine.request(asset);
    expect(response.status, asset).toBe(200);
    text += response.text;
  }
  return text;
};

describe("the published bundle", () => {
  let bundle: string;
  let scratch: string;
  const npmEnv = () => ({ ...process.env, npm_config_cache: join(scratch, "npm-cache"), npm_config_update_notifier: "false" });

  beforeAll(async () => {
    // Inside the repository, not the OS temp folder: npm looks for a workspace root in
    // every folder above the one it runs in, and a stray manifest above the temp folder
    // turns the client shim into someone else's workspace member.
    const base = join(repoRoot, "node_modules", ".cache");
    await mkdir(base, { recursive: true });
    scratch = await mkdtemp(join(base, "unframed-bundle-"));
    bundle = process.env.UNFRAMED_BUNDLE_DIR ?? join(scratch, "bundle");
    if (process.env.UNFRAMED_BUNDLE_DIR === undefined) await buildBundle(bundle, { TLDRAW_LICENSE_KEY: undefined });
  });
  afterAll(() => rm(scratch, { recursive: true, force: true }));

  it("has the documented flat layout", async () => {
    const hasLicense = existsSync(join(repoRoot, "LICENSE"));
    expect((await readdir(bundle)).sort()).toEqual(
      ["THIRD_PARTY_NOTICES", "client", "package.json", "server", ...(hasLicense ? ["LICENSE"] : [])].sort(),
    );
    const engineManifest = JSON.parse(await readFile(join(repoRoot, "packages/engine/package.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(bundle, "package.json"), "utf8"));
    expect(manifest).toEqual({
      name: "unframed",
      version: engineManifest.version,
      type: "module",
      main: "server/index.js",
      dependencies: { "@anthropic-ai/claude-agent-sdk": engineManifest.dependencies["@anthropic-ai/claude-agent-sdk"] },
    });
    const server = await listFiles(join(bundle, "server"));
    expect(server).toContain("index.js");
    expect(server.every((file) => file.endsWith(".js"))).toBe(true);
    const code = await readFile(join(bundle, "server", "index.js"), "utf8");
    expect(code).not.toMatch(/sourceMappingURL/);
    expect(code).not.toMatch(/workspace:/);
    expect(code).toMatch(/import\(["']@anthropic-ai\/claude-agent-sdk["']\)/);
    expect(code).not.toMatch(/from\s+["'][^"']+\.ts["']/);
    expect(code).not.toMatch(/(?:from\s+|require\()["']@unframed\//);
    expect(code).not.toMatch(/onTestFinished|startOpenRouterStub/);
    const client = await listFiles(join(bundle, "client"));
    expect(client).toContain("dist/index.html");
    expect(client).toContain("package.json");
    expect(client).toContain("package-lock.json");
    expect(client.filter((file) => file.endsWith(".map"))).toEqual([]);
    const notices = await readFile(join(bundle, "THIRD_PARTY_NOTICES"), "utf8");
    expect(notices).toContain("t3code");
    expect(notices).toContain("MIT License");
  });

  it.skipIf(!existsSync(join(repoRoot, "LICENSE")))("carries the repository's LICENSE", async () => {
    expect(await readFile(join(bundle, "LICENSE"), "utf8")).toBe(await readFile(join(repoRoot, "LICENSE"), "utf8"));
  });

  it("boots from server/index.js with the hosted variables: ready message, banner and the web at /", async () => {
    const engine = await startEngine({ entry: join(bundle, "server", "index.js"), clientDist: join(bundle, "client", "dist") });
    expect(engine.messages).toContainEqual({ type: "ready", port: engine.port, previewPort: engine.previewPort });
    expect(engine.stdout()).toContain(`  Unframed server  →  http://localhost:${engine.port}\n`);
    const index = await engine.request("/");
    expect(index.status).toBe(200);
    expect(index.text).toContain("<title>Unframed</title>");
    await servedAssets(engine);
    expect((await (await engine.rpc()).call("server.health")).ok).toBe(true);
    expect((await engine.stop()).code).toBe(0);
  });

  it("uses the bundle root as the data folder when UNFRAMED_DATA_DIR is unset", async () => {
    const copy = join(scratch, "data-dir-copy");
    await cp(bundle, copy, { recursive: true });
    const engine = await startEngine({ entry: join(copy, "server", "index.js"), env: { UNFRAMED_DATA_DIR: undefined } });
    const rpc = await engine.rpc();
    expect((await rpc.call("server.health")).outputDir).toBe(join(realpathSync(copy), "output"));
    await rpc.call("settings.update", { textModel: "bundle/root" });
    expect(existsSync(join(repoRoot, ".env"))).toBe(false);
    expect(await readFile(join(copy, ".env"), "utf8")).toBe("OPENROUTER_TEXT_MODEL=bundle/root\n");
  });

  it("installs with plain npm install into an empty folder and the installed engine boots", { timeout: 120_000 }, async () => {
    const packs = join(scratch, "packs");
    const target = join(scratch, "install-target");
    await mkdir(packs, { recursive: true });
    await mkdir(target, { recursive: true });
    // A manifest of its own, so npm installs here and does not walk up to the repository's.
    await writeFile(join(target, "package.json"), `${JSON.stringify({ name: "install-check", private: true })}\n`);
    const { stdout } = await npm(["pack", bundle, "--pack-destination", packs, "--silent"], { env: npmEnv() });
    const tarball = join(packs, stdout.trim().split("\n").at(-1)!);
    await npm(["install", tarball, "--no-audit", "--no-fund"], { cwd: target, env: npmEnv() });
    const installed = join(target, "node_modules", "unframed");
    // The Agent SDK is the one runtime dependency; npm brings it and its peers.
    expect(await readdir(join(target, "node_modules"))).toEqual(expect.arrayContaining([".package-lock.json", "unframed", "@anthropic-ai"]));
    expect(existsSync(join(target, "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json"))).toBe(true);
    const engine = await startEngine({
      entry: join(installed, "server", "index.js"),
      clientDist: join(installed, "client", "dist"),
    });
    expect(engine.messages).toContainEqual({ type: "ready", port: engine.port, previewPort: engine.previewPort });
    expect((await engine.request("/")).text).toContain("<title>Unframed</title>");
  });

  it("keeps the client shim working: npm ci and npm run build in client/ succeed and leave client/dist untouched", { timeout: 120_000 }, async () => {
    const copy = join(scratch, "shim-copy");
    await cp(bundle, copy, { recursive: true });
    const before = await hashTree(join(copy, "client", "dist"));
    await npm(["--prefix", join(copy, "client"), "ci", "--no-audit", "--no-fund"], { env: npmEnv() });
    await npm(["--prefix", join(copy, "client"), "run", "build"], { env: npmEnv() });
    expect(await hashTree(join(copy, "client", "dist"))).toEqual(before);
  });
});

describe("tldraw license key plumbing", () => {
  it("embeds TLDRAW_LICENSE_KEY in the served web when the build has one, and nothing when it does not", async () => {
    const scratch = await makeTempDir("unframed-key-");
    const withKey = join(scratch, "with-key");
    const withoutKey = join(scratch, "without-key");
    await buildBundle(withKey, { TLDRAW_LICENSE_KEY: "test-key" });
    await buildBundle(withoutKey, { TLDRAW_LICENSE_KEY: undefined });

    const keyed = await startEngine({ entry: join(withKey, "server", "index.js"), clientDist: join(withKey, "client", "dist") });
    expect(await servedAssets(keyed)).toContain("test-key");
    const plain = await startEngine({ entry: join(withoutKey, "server", "index.js"), clientDist: join(withoutKey, "client", "dist") });
    expect(await servedAssets(plain)).not.toContain("test-key");
    // The engine never reads or prints the key.
    expect(await readFile(join(withKey, "server", "index.js"), "utf8")).not.toContain("test-key");
    expect(keyed.stdout()).not.toContain("test-key");
  });
});
