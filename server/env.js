import fs from 'node:fs/promises';
import path from 'node:path';

// The one place that edits .env. Every setting the UI can change is written here,
// so a key or model chosen in the app survives a restart the same way a hand-typed
// line does.
//
// Trust boundary: these values arrive from the browser and end up in a shell-ish
// file (and, for the key, in an HTTP header). Only single clean tokens are
// accepted -- no newlines, no quotes -- so nothing can inject a second line or a
// second header.
export const PATTERNS = {
  OPENROUTER_API_KEY: /^sk-or-[\w.-]{8,200}$/,
  // OpenRouter slugs are vendor/model, sometimes with a :variant suffix.
  OPENROUTER_IMAGE_MODEL: /^[\w.-]+\/[\w.:-]+$/,
  OPENROUTER_TEXT_MODEL: /^[\w.-]+\/[\w.:-]+$/,
  OPENROUTER_VIDEO_MODEL: /^[\w.-]+\/[\w.:-]+$/,
  // A path, absolute or relative to the project root. Anything but the line
  // breaks and quotes that would corrupt the file.
  OUTPUT_DIR: /^[^\n\r"'#]{1,400}$/,
};

// Rewrite `text` so each key in `updates` holds its new value. A null value
// deletes the line outright rather than blanking it, so a value provided by the
// shell isn't shadowed by an empty assignment on the next load.
export function upsertEnv(text, updates) {
  let out = text;
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (value === null) {
      out = out.replace(new RegExp(`^${key}=.*\\r?\\n?`, 'm'), '');
      continue;
    }
    const line = `${key}=${value}`;
    out = re.test(out)
      ? out.replace(re, line)
      : `${out}${out && !out.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  return out;
}

// Where user data lives. Defaults to the project root, which is right for a
// clone; a packaged app points UNFRAMED_DATA_DIR at a writable directory,
// because there the root is inside a read-only bundle. Both rules live here
// rather than at their call sites so the read path and the write path cannot
// drift -- writing .env somewhere the next boot does not read it loses the key
// silently.
export const envFile = (root) => path.join(process.env.UNFRAMED_DATA_DIR || root, '.env');

// An absolute dir passes through untouched, which is what the folder picker and
// the packaged app both hand in; a relative one lands under the data dir.
export const outputPath = (root, dir) =>
  path.resolve(process.env.UNFRAMED_DATA_DIR || root, dir || './output');

// The only thing that writes .env, and it does two things a plain fs.writeFile
// does not. Mirrors writeJobs in jobs.js -- pure logic above, thin I/O here.
//
// 0600, because this file holds a payment credential. fs.writeFile with no mode
// lands at 0644 under the usual umask, so every other account on the machine can
// read the key. The mode goes on the TEMP file, and the rename carries it to the
// destination -- which means an .env that already exists at 0644, as it does for
// every install predating this, is tightened by the next write with no migration
// step and no separate chmod pass.
//
// Write-then-rename, because rename is atomic on the same filesystem while a
// direct write is not. jobs.js takes this precaution for a job record; the case
// here is stronger. A truncated jobs.json costs resumability, which the sweep can
// often recover. A truncated .env costs a key that NOTHING can re-fetch -- every
// reconnect mints a new one at OpenRouter -- plus the output folder and the three
// model slugs, all in one line-buffered instant.
//
// The temp name carries pid and time, so two processes writing at once cannot
// collide on it; the rename is what actually makes this safe.
export async function writeEnvFile(file, text) {
  const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    // The temp holds the full key at 0600, and nothing else ever deletes it. A
    // failed rename would leave a plaintext copy on disk -- another with every
    // retry -- that "Remove key" does not touch. Clean it up, best-effort, and
    // surface the original failure.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
