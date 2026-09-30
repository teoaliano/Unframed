/**
 * `node scripts/checkEngineTag.ts engine-v<semver>`: refuses a tag whose version is not the
 * engine package version, so the version an app reports matches the code it runs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./buildWeb.ts";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const tag = process.argv[2] ?? "";
const match = /^engine-v(.+)$/.exec(tag);
const version = match?.[1];
if (version === undefined || !SEMVER.test(version)) {
  process.stderr.write(`${tag} is not an engine-v<semver> tag.\n`);
  process.exit(1);
}
const engine = JSON.parse(await readFile(join(repoRoot, "packages/engine/package.json"), "utf8"));
if (engine.version !== version) {
  process.stderr.write(`The tag says ${version} but packages/engine/package.json says ${engine.version}.\n`);
  process.exit(1);
}
process.stdout.write(`  ${tag} matches the engine version.\n`);
