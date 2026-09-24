// Files a person hands the agent in the composer: what kind of thing one is, how big it
// may be, and what the agent is told about it. All pure -- the disk half is
// `attachmentStore.js`.
//
// The classification is lifted from t3code (github.com/pingdotgg/t3code, MIT:
// apps/web/src/components/chat/composerAttachmentFiles.ts and
// packages/client-runtime/src/state/attachments.ts), with the comments that explain WHY,
// because that is the part worth having. The case nobody designs for in advance is the
// first one below: a drag from another app, or a file piped through a shell, hands over a
// File with an empty or generic MIME type, and a plain `photo.jpg` silently becomes a
// generic attachment the model cannot look at.
//
// Where they live is the other half, and it is `attachmentStore.js`: this file has NO node
// imports and never will, because the composer imports it too -- deciding whether a paste
// is an attachment or a text paste has to happen in the browser, synchronously, and a
// second copy of the classification is a composer that disagrees with the server about
// what a file is. That is the same reason `graph/ops.js` imports from `server/graph.js`.

// What a provider will actually look at. Anything else is a file it can only read off
// disk, which is why the third classification exists: an image we cannot send inline is
// not the same as a spreadsheet, and telling someone their HEIC "is not an image" is wrong.
export const SUPPORTED_IMAGE_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'];
const SUPPORTED = new Set(SUPPORTED_IMAGE_TYPES);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PER_MESSAGE = 8;

const IMAGE_TYPE_BY_EXTENSION = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const HEIC_TYPE = /^image\/hei[cf]$/i;
const HEIC_EXTENSION = /\.hei[cf]$/i;

const generic = (type) => {
  const t = String(type ?? '').toLowerCase();
  return t === '' || t === 'application/octet-stream';
};

// Some sources (drags from other apps, files piped through a shell) hand over a file with
// an empty or generic MIME type. Maps the extension to a supported image type so a plain
// `photo.jpg` still lands on the image path; anything unrecognised stays a generic file.
export function inferImageType(name) {
  const dot = String(name ?? '').lastIndexOf('.');
  if (dot <= 0) return null;
  return IMAGE_TYPE_BY_EXTENSION[String(name).slice(dot + 1).toLowerCase()] ?? null;
}

const inferForUnknown = ({ name, type }) => (generic(type) ? inferImageType(name) : null);

// Finder and some browsers omit the MIME type when dragging HEIC photos.
export const isHeic = ({ name, type }) => HEIC_TYPE.test(String(type ?? '')) || (generic(type) && HEIC_EXTENSION.test(String(name ?? '')));

export function classify({ name = '', type = '' } = {}) {
  // t3code calls HEIC an image because it re-encodes one in the browser before sending.
  // Unframed does not, so here it is an image we cannot send INLINE -- the agent still
  // gets its path and can open it with its own tools, which is why this is
  // `unsupported-image` and not `file`.
  if (isHeic({ name, type })) return 'unsupported-image';
  if (inferForUnknown({ name, type })) return 'image';
  if (!String(type).toLowerCase().startsWith('image/')) return 'file';
  return SUPPORTED.has(String(type).toLowerCase()) ? 'image' : 'unsupported-image';
}

// An extension-recognised image gets a concrete type before anything else touches it, so
// nothing downstream has to repeat the inference.
export function normalizeType({ name = '', type = '' } = {}) {
  return inferForUnknown({ name, type }) ?? String(type ?? '').toLowerCase();
}

// The extension a type implies, for a file whose NAME carries none. A pasted screenshot
// arrives as `Image` with a real `image/png` type, and storing that as `.bin` threw away
// the one thing that says the model can look at it.
const EXTENSION_BY_IMAGE_TYPE = { 'image/gif': '.gif', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
export const extensionForType = (type) => EXTENSION_BY_IMAGE_TYPE[String(type ?? '').toLowerCase()] ?? '';

// "3.2 MB" / "48 KB". Never "0 KB": a file the person can see has a size.
export const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`);

// Both numbers, deliberately: "too large" alone leaves someone guessing whether to shrink
// it or split the request (the spec's user story 6).
export const tooLargeMessage = (name, size, limit) => `'${name}' is ${formatSize(size)}, over the ${formatSize(limit)} limit for that kind of attachment.`;

// The whole check, as a value rather than a throw, so a route can turn it into a status
// and the composer can turn the same sentence into a message beside the file.
export function checkAttachment({ name, type, size }) {
  const kind = classify({ name, type });
  // An image we cannot send inline still gets the image limit: it is a picture, and
  // the larger allowance is for things that are never inlined into a request.
  const limit = kind === 'file' ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
  if (!(size > 0)) return { ok: false, error: `'${name}' is empty.` };
  if (size > limit) return { ok: false, error: tooLargeMessage(name, size, limit) };
  return { ok: true, kind, type: normalizeType({ name, type }) || 'application/octet-stream' };
}


// Whether a paste's files should be claimed as attachments instead of falling through to
// the default text paste. From t3code, with its reasoning: deliberately no capacity gate
// here -- the send path owns those limits and reports them, where a gate at this layer
// would swallow the paste with no feedback. A copied image always wins; files alongside
// actual text do not, because someone pasting a screenshot and a caption meant the
// caption too.
export function shouldHandlePaste({ files = [], plainText = '' } = {}) {
  if (files.some((f) => classify(f) !== 'file')) return true;
  if (plainText.length > 0) return false;
  return files.length > 0;
}

// What the agent is TOLD about them. The path goes into the turn's text as well as the
// file going to the provider natively, so the model can both look at an image and
// dereference the path. A path in a prompt grants nothing on its own: the provider's
// sandbox and our permission matrix still decide what may be read, and an upload is never
// copied into the project to dodge them.
export function attachmentLines(attachments = []) {
  if (!attachments.length) return '';
  return attachments.map((a) => `Attached ${a.kind === 'file' ? 'file' : 'image'} "${a.name}": ${a.path}`).join('\n');
}

// The provider's native input: an image the model can actually look at becomes a content
// block, everything else is named by its path alone (the text above).
export function providerContent(text, attachments = []) {
  const images = attachments.filter((a) => a.kind === 'image' && SUPPORTED.has(a.type) && a.data);
  if (!images.length) return text;
  return [
    ...images.map((a) => ({ type: 'image', source: { type: 'base64', media_type: a.type, data: a.data } })),
    { type: 'text', text },
  ];
}
