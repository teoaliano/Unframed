// node server/attachments.test.js  (also runs as part of `npm test`)
//
// The MIME-type edge cases are pinned here rather than rediscovered one bug at a time --
// which is the whole reason the classification was lifted from t3code instead of written.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classify,
  inferImageType,
  normalizeType,
  isHeic,
  checkAttachment,
  tooLargeMessage,
  formatSize,
  shouldHandlePaste,
  attachmentLines,
  providerContent,
  MAX_IMAGE_BYTES,
  MAX_FILE_BYTES,
} from './attachments.js';
import { attachmentExtension, attachmentId, resolveAttachment, storeAttachment, attachmentsDir } from './attachmentStore.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-attachments-test-'));

// ---- a browser that reported nothing ----
// A drag from another app, or a file piped through a shell, hands over an empty MIME
// type. The extension is the only thing left, and without this a plain photo.jpg is
// silently downgraded to something the model cannot look at.
assert.equal(classify({ name: 'photo.jpg', type: '' }), 'image');
assert.equal(classify({ name: 'photo.JPG', type: '' }), 'image', 'extensions are not case-sensitive');
assert.equal(classify({ name: 'photo.png', type: 'application/octet-stream' }), 'image', 'and neither is the generic type');
assert.equal(normalizeType({ name: 'photo.jpg', type: '' }), 'image/jpeg', 'given a concrete type before anything else touches it');
assert.equal(inferImageType('a.webp'), 'image/webp');
assert.equal(inferImageType('noextension'), null);
assert.equal(inferImageType('.hidden'), null, 'a leading dot is not an extension');
assert.equal(inferImageType('notes.txt'), null);

// A reported type is believed over the extension: renaming a PDF to .png does not make it one.
assert.equal(classify({ name: 'report.png', type: 'application/pdf' }), 'file');
assert.equal(normalizeType({ name: 'report.png', type: 'application/pdf' }), 'application/pdf');

// ---- an image we cannot send inline is not a spreadsheet ----
assert.equal(classify({ name: 'diagram.svg', type: 'image/svg+xml' }), 'unsupported-image');
assert.equal(classify({ name: 'scan.tiff', type: 'image/tiff' }), 'unsupported-image');
// HEIC: Finder omits the type when dragging one, and t3code re-encodes it in the browser
// where Unframed does not -- so here it is an image we cannot send INLINE, and the agent
// still gets its path.
assert.equal(isHeic({ name: 'IMG_1.HEIC', type: '' }), true);
assert.equal(isHeic({ name: 'IMG_1.heif', type: 'application/octet-stream' }), true);
assert.equal(isHeic({ name: 'x', type: 'image/heic' }), true);
assert.equal(isHeic({ name: 'IMG_1.heic', type: 'image/png' }), false, 'a reported type wins');
assert.equal(classify({ name: 'IMG_1.HEIC', type: '' }), 'unsupported-image');

// ---- anything else is a file ----
assert.equal(classify({ name: 'data.csv', type: 'text/csv' }), 'file');
assert.equal(classify({ name: 'archive', type: '' }), 'file');
assert.equal(classify(), 'file', 'nothing at all is still an answer');

// ---- the size limit says both numbers ----
// "Too large" alone leaves someone guessing whether to shrink it or split the request.
{
  const big = checkAttachment({ name: 'huge.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 });
  assert.equal(big.ok, false);
  assert.match(big.error, /huge\.png/);
  assert.match(big.error, /10\.0 MB/, 'its size');
  assert.match(big.error, /over the 10\.0 MB limit/, 'and the limit');

  assert.equal(checkAttachment({ name: 'ok.png', type: 'image/png', size: MAX_IMAGE_BYTES }).ok, true, 'exactly the limit is allowed');
  // A generic file gets the larger limit: it is never inlined into a request.
  assert.equal(checkAttachment({ name: 'notes.txt', type: 'text/plain', size: MAX_IMAGE_BYTES + 1 }).ok, true);
  assert.equal(checkAttachment({ name: 'notes.txt', type: 'text/plain', size: MAX_FILE_BYTES + 1 }).ok, false);
  assert.equal(checkAttachment({ name: 'empty.png', type: 'image/png', size: 0 }).ok, false, 'an empty file is a mistake, not an attachment');

  assert.equal(formatSize(512), '1 KB', 'never 0 KB: a file the person can see has a size');
  assert.equal(formatSize(2 * 1024 * 1024), '2.0 MB');
  assert.match(tooLargeMessage('a.png', 3000, 1024), /'a\.png' is 3 KB, over the 1 KB limit/);
}

// ---- an id reaches a filesystem path, so it cannot carry anything a path objects to ----
assert.equal(attachmentExtension('a.PNG'), '.png');
assert.equal(attachmentExtension('archive.tar.gz'), '.gz');
assert.equal(attachmentExtension('noextension'), '.bin');
assert.equal(attachmentExtension('weird.thisistoolongforanextension'), '.bin');
// The id's extension is the only record of what the file IS once the upload is over, so
// when the name carries none the TYPE supplies one. A pasted screenshot arrives as
// `Image` with a real image type, and storing that as `.bin` made the turn reclassify it
// as a generic file and hand the model a path instead of a picture.
assert.equal(attachmentExtension('Image', 'image/png'), '.png');
assert.equal(attachmentExtension('screenshot', 'image/jpeg'), '.jpg');
assert.equal(attachmentExtension('notes', 'text/csv'), '.bin', 'only an image type implies one');
assert.equal(attachmentExtension('report.pdf', 'image/png'), '.pdf', 'a real extension wins');
{
  const id = attachmentId(Buffer.from('hello'), 'a.png');
  assert.match(id, /^[0-9a-f]{32}\.png$/);
  assert.equal(id, attachmentId(Buffer.from('hello'), 'b.png'), 'content-addressed: the same bytes are one file');
  assert.notEqual(id, attachmentId(Buffer.from('other'), 'a.png'));
  // What the upload decided survives into the id, so the message route reaches the same
  // answer from the id alone.
  const pasted = attachmentId(Buffer.from('hello'), 'Image', 'image/png');
  assert.match(pasted, /\.png$/);
  assert.equal(classify({ name: pasted, type: '' }), 'image', 'and it still reads as an image a turn later');
}
for (const bad of ['../../.env', '/etc/passwd', 'a/b.png', '..', '', 'a\0b']) {
  assert.equal(resolveAttachment(root, bad), null, `refused: ${JSON.stringify(bad)}`);
}
assert.equal(resolveAttachment(root, 'abc.png'), path.join(root, 'abc.png'));

// ---- stored outside the project folder, and idempotent ----
{
  const dir = attachmentsDir(root);
  assert.equal(dir, path.join(root, 'attachments'));
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const stored = await storeAttachment(dir, { name: 'hero.png', type: 'image/png', bytes });
  assert.equal(stored.ok, true);
  assert.equal(stored.attachment.kind, 'image');
  assert.equal(stored.attachment.size, bytes.length);
  assert.equal(path.dirname(stored.attachment.path), dir);
  assert.deepEqual(await fs.readFile(stored.attachment.path), bytes);
  // The same bytes again write nothing new and answer with the same id.
  const twice = await storeAttachment(dir, { name: 'copy.png', type: 'image/png', bytes });
  assert.equal(twice.attachment.id, stored.attachment.id);
  assert.deepEqual((await fs.readdir(dir)).sort(), [stored.attachment.id]);
  // A pasted screenshot, whose name carries nothing: it is stored as an image and still
  // reads as one from its id alone.
  const pasted = await storeAttachment(dir, { name: 'Image', type: 'image/png', bytes: Buffer.from('other') });
  assert.equal(pasted.attachment.kind, 'image');
  assert.match(pasted.attachment.id, /\.png$/);
  assert.equal(classify({ name: pasted.attachment.id, type: '' }), 'image');
  // An oversized one never reaches the disk.
  const refused = await storeAttachment(dir, { name: 'huge.png', type: 'image/png', bytes: Buffer.alloc(MAX_IMAGE_BYTES + 1) });
  assert.equal(refused.ok, false);
  assert.equal((await fs.readdir(dir)).length, 2);
}

// ---- what the agent is told, and what the provider is given ----
{
  const image = { id: 'a.png', name: 'hero.png', type: 'image/png', kind: 'image', size: 8, path: '/data/attachments/a.png', data: 'aGk=' };
  const file = { id: 'b.csv', name: 'rows.csv', type: 'text/csv', kind: 'file', size: 8, path: '/data/attachments/b.csv' };
  assert.equal(attachmentLines([]), '');
  assert.equal(attachmentLines([image]), 'Attached image "hero.png": /data/attachments/a.png');
  assert.match(attachmentLines([image, file]), /Attached file "rows\.csv": \/data\/attachments\/b\.csv/);

  // The path goes in the text AND the image goes natively, so the model can both look at
  // it and dereference the path.
  assert.equal(providerContent('hi', []), 'hi', 'no attachments: still a plain string');
  assert.equal(providerContent('hi', [file]), 'hi', 'a file the model cannot look at is named by its path alone');
  const content = providerContent('hi', [image, file]);
  assert.equal(content.length, 2);
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } });
  assert.deepEqual(content[1], { type: 'text', text: 'hi' });
  // An image type no provider accepts is not smuggled in as one.
  assert.equal(providerContent('hi', [{ ...image, type: 'image/svg+xml', kind: 'unsupported-image' }]), 'hi');
}

// ---- a paste is an attachment, or it is text ----
// No capacity gate here, deliberately: the send path owns those limits and reports them,
// where a gate at this layer would swallow the paste with no feedback.
{
  const image = { name: 'shot.png', type: 'image/png' };
  const doc = { name: 'notes.txt', type: 'text/plain' };
  assert.equal(shouldHandlePaste({ files: [image], plainText: '' }), true);
  assert.equal(shouldHandlePaste({ files: [image], plainText: 'a caption' }), true, 'a copied image always wins');
  assert.equal(shouldHandlePaste({ files: [doc], plainText: 'a caption' }), false, 'someone pasting a file and text meant the text too');
  assert.equal(shouldHandlePaste({ files: [doc], plainText: '' }), true);
  assert.equal(shouldHandlePaste({ files: [], plainText: 'just words' }), false);
  assert.equal(shouldHandlePaste(), false);
  // The browser reported nothing, as it does for a drag from another app.
  assert.equal(shouldHandlePaste({ files: [{ name: 'shot.png', type: '' }], plainText: 'x' }), true);
}

await fs.rm(root, { recursive: true, force: true });
console.log('attachments.test.js: ok');
