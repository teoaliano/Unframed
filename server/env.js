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
    // Global on purpose. A key can end up on more than one line -- the manual
    // setup path tells the user to add one, and appending rather than editing is
    // the ordinary mistake -- and dotenv keeps the LAST assignment, so acting on
    // only the first is how "Remove key" reports success with the key still live
    // after a restart, and how "replace" leaves the stale value winning.
    if (value === null) {
      out = out.replace(new RegExp(`^${key}=.*\\r?\\n?`, 'mg'), '');
      continue;
    }
    const line = `${key}=${value}`;
    // One pass replaces the first occurrence in place and drops every later one,
    // so a file with duplicates collapses to a single line where the first was.
    let found = false;
    out = out.replace(new RegExp(`^${key}=.*\\r?\\n?`, 'mg'), (m) => {
      if (found) return '';
      found = true;
      const nl = m.match(/\r?\n$/); // preserve the line's own ending
      return line + (nl ? nl[0] : '');
    });
    if (!found) out = `${out}${out && !out.endsWith('\n') ? '\n' : ''}${line}\n`;
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
