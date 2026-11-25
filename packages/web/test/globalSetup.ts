import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWeb } from "../../../scripts/buildWeb.ts";
import { sweepTempDirs } from "../../engine/test/engineProcess.ts";

/** Builds the web once into a temporary folder that every test's engine serves. */
export default async function globalSetup() {
  await sweepTempDirs();
  const outDir = await mkdtemp(join(tmpdir(), "unframed-web-"));
  await buildWeb(join(outDir, "dist"));
  process.env.UNFRAMED_TEST_WEB_DIST = join(outDir, "dist");
  return async () => {
    await rm(outDir, { recursive: true, force: true });
  };
}
