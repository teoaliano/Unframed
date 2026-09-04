// node server/media.test.js  (also runs as part of `npm test`)
//
// Media leaves the document: a data: URL in node data becomes a file in the project
// folder plus a sidecar, and the node keeps only the file's name. Pure parts (finding,
// decoding, naming) and the one I/O function that ties them together.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decodeDataUrl, extOf, findInlineMedia, mediaFileName, extractMedia, extractFromOp, fileRef, inlineFileRefs } from './media.js';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const MP4_STUB = `data:video/mp4;base64,${Buffer.from('not really an mp4').toString('base64')}`;

// ---- decodeDataUrl ----
{
  const d = decodeDataUrl(PNG_1PX);
  assert.equal(d.mime, 'image/png');
  assert.equal(d.bytes.length, 70);
  assert.equal(d.bytes[0], 0x89); // PNG magic
  assert.equal(decodeDataUrl('https://example.com/clip.mp4'), null, 'a hosted URL is not inline media');
  assert.equal(decodeDataUrl('data:text/plain,hello'), null, 'non-base64 data URLs are not media');
  assert.equal(decodeDataUrl(''), null);
  assert.equal(decodeDataUrl(undefined), null);
}

// ---- extOf: the extension comes from the mime type, with the original name as a hint ----
{
  assert.equal(extOf('image/png', 'whatever.PNG'), 'png');
  assert.equal(extOf('image/jpeg', 'photo.jpg'), 'jpg');
  assert.equal(extOf('image/webp', ''), 'webp');
  assert.equal(extOf('video/mp4', 'clip.mp4'), 'mp4');
  assert.equal(extOf('video/quicktime', 'clip.mov'), 'mov');
  assert.equal(extOf('application/octet-stream', 'thing.gif'), 'gif', 'falls back to the name');
  assert.equal(extOf('application/octet-stream', 'thing'), 'bin');
}

// ---- mediaFileName: same shape as every other file in the folder ----
{
  const name = mediaFileName(1700000000000, 'My Photo (final).PNG', 'png');
  assert.match(name, /^1700000000000-my-photo-final\.png$/);
  assert.equal(mediaFileName(1700000000000, '', 'mp4'), '1700000000000-upload.mp4');
  // A second file in the same millisecond must not collide: the caller passes a
  // discriminator when it has to.
  assert.equal(mediaFileName(1700000000000, 'a.png', 'png', 2), '1700000000000-a-2.png');
}

// ---- findInlineMedia: only image/video nodes, only data: URLs ----
{
  const nodes = [
    { id: '1', type: 'image', data: { dataUrl: PNG_1PX, fileName: 'a.png' } },
    { id: '2', type: 'video', data: { dataUrl: 'https://cdn.example/clip.mp4', fileName: 'clip.mp4' } },
    { id: '3', type: 'prompt', data: { text: 'data:image/png;base64,AAAA' } }, // text that looks like a URL is text
    { id: '4', type: 'image', data: { file: '1-a.png', fileName: 'a.png' } }, // already extracted
    { id: '5', type: 'video', data: { dataUrl: MP4_STUB, fileName: 'b.mp4' } },
  ];
  assert.deepEqual(findInlineMedia(nodes).map((n) => n.id), ['1', '5']);
}

// ---- extractMedia: writes files + sidecars, rewrites data, leaves everything else ----
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-media-test-'));
  const graph = {
    nodes: [
      { id: '1', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: PNG_1PX, fileName: 'Hero.png', aspect: 1 } },
      { id: '2', type: 'video', position: { x: 0, y: 0 }, data: { dataUrl: MP4_STUB, fileName: 'pour.mp4' } },
      { id: '3', type: 'video', position: { x: 0, y: 0 }, data: { dataUrl: 'https://cdn.example/x.mp4', fileName: 'x.mp4' } },
      { id: '4', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'hi' } },
    ],
    edges: [],
  };
  const { graph: out, ops } = await extractMedia(graph, dir, { now: () => 1700000000000, source: 'legacy-graph' });
  const one = out.nodes[0].data;
  assert.equal(one.dataUrl, undefined);
  assert.equal(one.fileName, 'Hero.png');
  assert.equal(one.aspect, 1, 'unrelated data keys survive');
  assert.match(one.file, /^1700000000000-hero\.png$/);
  const bytes = await fs.readFile(path.join(dir, one.file));
  assert.equal(bytes.length, 70);
  const sidecar = JSON.parse(await fs.readFile(path.join(dir, one.file.replace(/\.png$/, '.json')), 'utf8'));
  assert.equal(sidecar.source, 'legacy-graph');
  assert.equal(sidecar.fileName, 'Hero.png');
  assert.equal(sidecar.bytes, 70);
  assert.equal(sidecar.mime, 'image/png');
  // Second file in the same ms gets a discriminator rather than overwriting the first.
  const two = out.nodes[1].data;
  assert.match(two.file, /^1700000000000-pour(-\d+)?\.mp4$/);
  assert.notEqual(one.file, two.file);
  // Hosted URL and non-media nodes untouched, by identity.
  assert.equal(out.nodes[2], graph.nodes[2]);
  assert.equal(out.nodes[3], graph.nodes[3]);
  // The ops that describe the rewrite, so a document can journal them.
  assert.deepEqual(
    ops.map((o) => [o.type, o.id, Object.keys(o.patch).sort()]),
    [
      ['updateNode', '1', ['dataUrl', 'file']],
      ['updateNode', '2', ['dataUrl', 'file']],
    ],
  );
  assert.equal(ops[0].patch.dataUrl, null, 'the patch deletes dataUrl');
  // Nothing inline: nothing written, same graph back by identity.
  const again = await extractMedia(out, dir, { now: () => 1 });
  assert.equal(again.graph, out);
  assert.deepEqual(again.ops, []);
  await fs.rm(dir, { recursive: true, force: true });
}

// ---- extractFromOp: an op arriving with inline media is rewritten before it applies ----
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-media-op-test-'));
  const add = { type: 'addNode', node: { id: 'n', type: 'image', position: { x: 0, y: 0 }, data: { dataUrl: PNG_1PX, fileName: 'a.png' } } };
  const a = await extractFromOp(add, dir, { now: () => 5 });
  assert.equal(a.node.data.dataUrl, undefined);
  assert.equal(a.node.data.file, '5-a.png');
  const patch = { type: 'updateNode', id: 'n', patch: { dataUrl: PNG_1PX, fileName: 'b.png', aspect: null } };
  const p = await extractFromOp(patch, dir, { now: () => 6 });
  assert.equal(p.patch.dataUrl, null, 'the patch now deletes the key instead of setting bytes');
  assert.equal(p.patch.file, '6-b.png');
  assert.equal(p.patch.aspect, null);
  // Inside a batch, too.
  const b = await extractFromOp({ type: 'batch', ops: [add, { type: 'moveNode', id: 'n', position: { x: 1, y: 1 } }] }, dir, { now: () => 7 });
  assert.equal(b.ops[0].node.data.file, '7-a.png');
  assert.equal(b.ops[1].type, 'moveNode');
  // Ops without inline media come back by identity.
  const move = { type: 'moveNode', id: 'n', position: { x: 0, y: 0 } };
  assert.equal(await extractFromOp(move, dir, { now: () => 8 }), move);
  const hosted = { type: 'updateNode', id: 'n', patch: { dataUrl: 'https://cdn/x.mp4' } };
  assert.equal(await extractFromOp(hosted, dir, { now: () => 9 }), hosted);
  await fs.rm(dir, { recursive: true, force: true });
}

// ---- inlineFileRefs: project-file: markers become data: URLs at the boundary ----
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-media-refs-test-'));
  const png = decodeDataUrl(PNG_1PX).bytes;
  await fs.writeFile(path.join(dir, '1-hero.png'), png);
  await fs.writeFile(path.join(dir, '2-clip.mp4'), Buffer.from('mp4 bytes'));
  assert.equal(fileRef('1-hero.png'), 'project-file:1-hero.png');
  const hosted = { type: 'video_url', video_url: { url: 'https://cdn.example/x.mp4' } };
  const already = { type: 'image_url', image_url: { url: PNG_1PX } };
  const refs = [
    { type: 'image_url', image_url: { url: fileRef('1-hero.png') } },
    hosted,
    { type: 'video_url', video_url: { url: fileRef('2-clip.mp4') } },
    already,
    { type: 'image_url', image_url: { url: fileRef('1-hero.png') }, frame_type: 'first_frame' },
  ];
  const out = await inlineFileRefs(refs, dir);
  assert.equal(out[0].image_url.url, PNG_1PX, 'the file comes back as exactly the data URL it was written from');
  assert.equal(out[1], hosted, 'a hosted URL is untouched, by identity');
  assert.match(out[2].video_url.url, /^data:video\/mp4;base64,/);
  assert.equal(out[3], already);
  assert.equal(out[4].frame_type, 'first_frame', 'frame entries keep their extra fields');
  // A path in the marker cannot escape the project folder.
  await fs.writeFile(path.join(dir, 'safe.png'), png);
  const escaped = await inlineFileRefs([{ type: 'image_url', image_url: { url: fileRef('../../etc/safe.png') } }], dir);
  assert.match(escaped[0].image_url.url, /^data:image\/png/);
  // A missing file is an error the route can report, not a broken reference sent upstream.
  await assert.rejects(() => inlineFileRefs([{ type: 'image_url', image_url: { url: fileRef('nope.png') } }], dir), /not found/);
  // Non-arrays pass through.
  assert.equal(await inlineFileRefs(undefined, dir), undefined);
  await fs.rm(dir, { recursive: true, force: true });
}

console.log('media.test.js: ok');
