// Where an attachment lives on disk. Split from attachments.js only because that file has
// to run in the browser (its header says why); everything here needs node, and nothing
// here is a decision -- the decisions are all next door.
//
// The path rules are lifted from t3code (github.com/pingdotgg/t3code, MIT:
// apps/server/src/attachmentPaths.ts and attachmentStore.ts).
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkAttachment } from './attachments.js';

export const attachmentsDir = (dataDir) => path.join(dataDir, 'attachments');

// A stored name is content-addressed, so the same file attached twice is one file on
// disk, and the id cannot carry anything a path would object to. The original name is
// kept in the id's tail only as an extension, because the id reaches a filesystem path.
const EXTENSION = /^\.[a-z0-9]{1,10}$/;

export function attachmentExtension(name) {
  const ext = path.extname(String(name ?? '')).toLowerCase();
  return EXTENSION.test(ext) ? ext : '.bin';
}

export const attachmentId = (bytes, name) => `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}${attachmentExtension(name)}`;

// Traversal-safe resolution, lifted from t3code's attachmentPaths.ts: an id arrives in a
// URL, and the only safe answer to one that escapes the directory is null.
export function resolveAttachment(dir, id) {
  const normalized = path.normalize(String(id ?? '')).replace(/^[/\\]+/, '');
  if (!normalized || normalized.startsWith('..') || normalized.includes('\0') || normalized.includes('/') || normalized.includes('\\')) return null;
  const root = path.resolve(dir);
  const file = path.resolve(path.join(root, normalized));
  return file.startsWith(`${root}${path.sep}`) ? file : null;
}

// Content-addressed, so writing the same bytes twice is idempotent and `wx` failing with
// EEXIST means the file is already exactly right.
export async function storeAttachment(dir, { name, type, bytes }) {
  const checked = checkAttachment({ name, type, size: bytes.length });
  if (!checked.ok) return checked;
  await fs.mkdir(dir, { recursive: true });
  const id = attachmentId(bytes, name);
  const file = path.join(dir, id);
  try {
    await fs.writeFile(file, bytes, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  return { ok: true, attachment: { id, name: String(name), type: checked.type, kind: checked.kind, size: bytes.length, path: file } };
}
