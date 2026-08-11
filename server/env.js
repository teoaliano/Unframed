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
