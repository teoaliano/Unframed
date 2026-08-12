// Presets you save from the canvas: one JSON array in one file at the root of
// OUTPUT_DIR, beside the project folders rather than inside one — a preset is
// yours, not any single project's. /api/projects lists directories only, so this
// file can never surface as a phantom project.
//
// Its own module, rather than four lines inside index.js, so the rule below can be
// asserted in presets.test.js: index.js starts listening at import and reads the
// real .env, so a test of the routes could only run against your actual output dir.
import fs from 'node:fs/promises';
import path from 'node:path';

export const presetsPath = (dir) => path.join(dir, 'presets.json');

// THE LOAD-BEARING DISTINCTION: "no file" and "file I cannot read" must not give the
// same answer. The client has no add-one operation — it re-reads this list, appends,
// and PUTs the whole array back — so answering [] for a file that exists but cannot
// be read would make the next save overwrite every preset in it, silently. Missing is
// genuinely empty (nothing saved yet); anything else throws, and the save aborts.
export async function readPresets(dir) {
  const raw = await fs.readFile(presetsPath(dir), 'utf8').catch((err) => {
    if (err.code === 'ENOENT') return '[]';
    throw err;
  });
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('presets.json is not valid JSON.');
  }
}

// Whole-array replace. Delete is the client filtering an item out and writing the
// rest, which is why there are no per-preset routes.
export async function writePresets(dir, presets) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(presetsPath(dir), JSON.stringify(presets, null, 2));
}
