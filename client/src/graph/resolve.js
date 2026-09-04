// Pure graph logic. No React, no network — just turn the node/edge graph into
// a single generation request. This is the only part with real logic; everything
// else is UI wiring.

// @ref references another PROMPT or TEXT node by its id (word chars + hyphens).
// Images are not referenced this way — they are sent as an ordered array and named
// positionally ("image 1", "image 2") which the user types as plain text.
const TOKEN_RE = /@([\w-]+)/g;

// The engine's one rule — inputs only feed edges, outputs consume them — as a
// predicate rather than a list of type strings repeated down this file. Output type
// ids end in `Output` so they cannot collide with the `image`/`video` INPUT nodes,
// which is also what makes this a shape test rather than a list: a fourth output kind
// is one type id, not a grep.
export const isOutput = (n) => Boolean(n?.type?.endsWith('Output'));
// A text output's stored ANSWER is what @id pulls in, never its instructions. Its own
// predicate because getting it wrong is silent: resolveRef below would fall through to
// substituting data.text, and generations would quietly build from the wrong text.
export const isTextOutput = (n) => n?.type === 'textOutput';
// The two kinds a TOKEN_RE match can ever resolve to, so "can this node be @-referenced"
// is asked in one place: the @ menu that offers candidates while typing, and the
// right-click item that copies a reference. Those two disagreeing is a menu offering an
// id nothing will substitute, or an id you can copy but never insert.
export const isReferenceable = (n) => n?.type === 'prompt' || isTextOutput(n) || isGroup(n);

// A group is a box of input nodes -- prompts, images, videos -- that wires as one source
// and is @-referenced as one id. It carries none of that content itself: a member is an
// ordinary node with `parentId` set and a position relative to the box, so there is one
// way to hold an image and one way to hold a prompt, and everything below that already
// handles those handles a group by expanding it. The server enforces who may be a member
// (server/graph.js); this file only has to read the result.
// Design: docs/superpowers/specs/2026-09-05-group-node-design.md.
export const isGroup = (n) => n?.type === 'group';

const byY = (a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0);

// A group's members, top to bottom INSIDE the box. Relative positions all share one
// parent, so comparing them is the same rule the canvas applies to everything else.
export const membersOf = (nodes, groupId) => nodes.filter((n) => n.parentId === groupId).sort(byY);

// Every node an @id can resolve to, by id. One helper because the same filter used to
// be written out in three places, and a third kind of referenceable node meant
// remembering all three.
const referenceMap = (nodes) => new Map(nodes.filter(isReferenceable).map((n) => [n.id, n]));

// Its own predicate for the same reason isTextOutput has one: only a video output
// carries an input mode, and asking the wrong node type for one silently changes
// what gets sent.
export const isVideoOutput = (n) => n?.type === 'videoOutput';

// Seedance takes exactly one task type per request -- references OR frames, never
// both (docs/superpowers/specs/2026-08-15-video-input-mode-design.md). The mode
// names map to the frame slots the request will carry.
const MODE_FRAMES = {
  first_frame: ['first_frame'],
  first_last: ['first_frame', 'last_frame'],
};

function substitute(text, refs, stack) {
  return (text || '').replace(TOKEN_RE, (all, raw) => {
    const ref = raw.trim();
    if (refs.has(ref)) return resolveRef(ref, refs, stack);
    return all; // unknown ref -> left as typed, same as insert.js's rewriter
  });
}

// Resolve one referenced node to text. Prompt nodes substitute recursively; a text
// node's model output is inserted literally — re-scanning it for @tokens would let
// model output pull in arbitrary prompts, and makes cycles unresolvable.
// Throws on circular prompt references (A -> B -> A).
function resolveRef(id, refs, stack) {
  const node = refs.get(id);
  if (isTextOutput(node)) return node.data?.result || '';
  if (stack.includes(id)) {
    throw new Error(`Circular reference: ${[...stack, id].join(' -> ')}`);
  }
  // @group is its prompt members, top to bottom, joined the way an output joins its
  // sources. Media members have no text and are not this path's business: they travel by
  // wire, never by mention, so a mention can never attach an image the canvas does not
  // show being sent.
  if (isGroup(node)) {
    return membersOf([...refs.values()], id)
      .map((m) => resolveRef(m.id, refs, [...stack, id]).trim())
      .filter(Boolean)
      .join('\n\n');
  }
  return substitute(node.data?.text, refs, [...stack, id]);
}

// Every source wired into one output, split by the role its mode gives them.
// The single home for that split: buildRequest sends from it and the input node
// badges read it, so what a node claims and what is sent cannot drift.
export function bucketSources(nodes, edges, outputId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const output = byId.get(outputId);
  // A wired group expands IN PLACE into its members: the box takes one slot in the
  // top-to-bottom order at its own position, and its contents fill that slot in their
  // order inside it. Contiguous rather than interleaved by absolute position, so "that
  // box is image 2 and 3" can be read off the canvas without adding coordinates.
  const sources = edges
    .filter((e) => e.target === outputId)
    .map((e) => byId.get(e.source))
    .filter(Boolean)
    .sort(byY)
    .flatMap((n) => (isGroup(n) ? membersOf(nodes, n.id) : [n]));

  const media = sources.filter((n) => (n.type === 'image' || n.type === 'video') && hasMedia(n));
  const mode = isVideoOutput(output) ? output?.data?.inputMode : undefined;
  const wanted = MODE_FRAMES[mode];
  if (!wanted) return { sources, references: media, frames: [], excess: [] };

  // Frames are images only, top to bottom -- the same Y ordering that decides
  // prompt order and "image 1".
  const images = media.filter((n) => n.type === 'image');
  const frames = wanted
    .map((frame_type, i) => (images[i] ? { node: images[i], frame_type } : null))
    .filter(Boolean);
  const used = new Set(frames.map((f) => f.node.id));
  return {
    sources,
    references: [],
    frames,
    excess: media.filter((n) => !used.has(n.id)).map((n) => n.id),
  };
}

// Where a media node's bytes are. `file` names a file in the project folder -- the
// normal case since media left the document (server/media.js) -- and `dataUrl` is kept
// for the one thing that is not a file: a hosted https video link. A node with neither
// is an empty reference slot.
export const hasMedia = (n) => Boolean(n?.data?.file || n?.data?.dataUrl);

// What a request carries for a media node. A file travels as a `project-file:` marker
// the server inlines to base64 at the OpenRouter boundary (server/media.js), so the
// browser never round-trips bytes that already sit on disk next to the server.
export const mediaRef = (n) => (n.data?.file ? `project-file:${n.data.file}` : n.data?.dataUrl);

// Media nodes -> the array the API takes. Shared by buildRequest and runReferences so a
// new reference kind cannot be added to one and silently forgotten in the other.
function toReferences(media) {
  return media.map((n) =>
    n.type === 'video'
      ? { type: 'video_url', video_url: { url: mediaRef(n) } }
      : { type: 'image_url', image_url: { url: mediaRef(n) } },
  );
}

// Build the generation request for a given output node id.
// Returns { prompt, input_references, frame_images }. frame_images is empty unless
// the output is a video node asking for a frame mode.
export function buildRequest(nodes, edges, outputId) {
  const refs = referenceMap(nodes);
  const { sources, references, frames } = bucketSources(nodes, edges, outputId);

  const input_references = toReferences(references);
  const frame_images = frames.map(({ node, frame_type }) => ({
    type: 'image_url',
    image_url: { url: mediaRef(node) },
    frame_type,
  }));

  const promptParts = [];
  for (const node of sources) {
    if (node.type !== 'prompt' && !isTextOutput(node)) continue;
    const text = resolveRef(node.id, refs, []).trim();
    if (text) promptParts.push(text);
  }

  return { prompt: promptParts.join('\n\n'), input_references, frame_images };
}

// What each consuming output will do with this image or video, one entry per
// consumer, deduplicated. A number is its position in that output's references
// ("image 2"); `first`/`last` is a frame slot; `—` means the output's mode has no
// room for it and it will not be sent. Per consumer because an image can be image 2
// to one node and the first frame of another. Kept beside bucketSources so the
// badge and the request cannot disagree. `nodes`/`edges` are the live arrays.
export function sourceRoles(nodes, edges, nodeId) {
  const self = nodes.find((n) => n.id === nodeId);
  if (!self || (self.type !== 'image' && self.type !== 'video') || !hasMedia(self)) return [];

  const roles = [];
  // Consumers in canvas order, top to bottom -- the same rule that orders prompts and
  // numbers references. Without it the badge would read "1 / 2" or "2 / 1" for the same
  // graph, depending only on which output happened to be created first.
  const consumers = nodes
    .filter(isOutput)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));
  for (const consumer of consumers) {
    const { references, frames, excess } = bucketSources(nodes, edges, consumer.id);
    const frame = frames.find((f) => f.node.id === nodeId);
    if (frame) {
      roles.push(frame.frame_type === 'first_frame' ? 'first' : 'last');
      continue;
    }
    if (excess.includes(nodeId)) {
      roles.push('—');
      continue;
    }
    // Numbering is per kind: "image 1" and "video 1" coexist on one consumer.
    const sameKind = references.filter((n) => n.type === self.type);
    const idx = sameKind.findIndex((n) => n.id === nodeId);
    if (idx !== -1) roles.push(String(idx + 1));
  }
  return [...new Set(roles)];
}

// The node supplying Free mode's list. A wired text output wins outright; only when
// none is wired does a prompt node stand in. Precedence rather than lowest-Y across
// both kinds: an existing Free graph with a context prompt sitting above its text
// output would otherwise silently change which node supplies the list, and a batch
// built from the wrong text is only noticed after it has been paid for. Lowest Y
// breaks ties within a kind, matching buildRequest's ordering.
export function findFreeSource(nodes, edges, outputId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const wired = edges
    .filter((e) => e.target === outputId)
    .map((e) => byId.get(e.source))
    .filter(Boolean)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));
  return wired.find(isTextOutput) || wired.find((n) => n.type === 'prompt');
}

// Free mode's list, as text. A text output's answer is taken verbatim -- never
// re-scanned for @tokens, per resolveRef's rule. A prompt node holds what the user
// typed, so its @ids are substituted first: an unexpanded @p-123 would otherwise
// reach the splitter as a literal token and travel to the model that way.
export function freeSourceText(node, nodes) {
  if (!node) return '';
  if (isTextOutput(node)) return node.data?.result || '';
  const refs = referenceMap(nodes);
  // Seeded with the source's own id so @itself throws Circular instead of recursing,
  // the same guard resolveRef applies.
  return substitute(node.data?.text, refs, [node.id]);
}

// Everything wired into the output EXCEPT the list source -- the context every Free run
// receives. Asking buildRequest for the graph with the source blanked (rather than
// subtracting its text from the joined prompt) is what keeps a blank line inside the
// list, or an @id reference to the source itself, from smuggling the whole list back in.
// BOTH text and result are blanked, so this works whichever kind of node the source is:
// known-and-empty is the intent, and an absent node would leave the @token itself in
// the prompt.
export function freeShared(nodes, edges, outputId, sourceId) {
  return buildRequest(
    nodes.map((n) => (n.id === sourceId ? { ...n, data: { ...n.data, text: '', result: '' } } : n)),
    edges,
    outputId,
  ).prompt;
}

// One prompt per Free-mode block: the shared context, then the block after a blank line.
export function freeRunPrompts(nodes, edges, outputId, sourceId, blocks) {
  const shared = freeShared(nodes, edges, outputId, sourceId);
  return blocks.map((b) => [shared, b].filter(Boolean).join('\n\n'));
}

// The run cap, for both a fixed count and Free mode. It lives here rather than beside
// RunsControl's number input because truncation is computed in this module and the dialog
// only quotes the number: a cap with two homes is a dialog stating a limit nothing
// enforces. This module has no JSX, so the UI can import it and not the reverse.
export const MAX_RUNS = 10;

// Split a text node's result into one block per run. The separator is a line that
// contains only "---", so a --- inside prose is left alone. `max` is the run cap;
// `truncated` lets the caller say "list had 14 items, running the first 10" instead
// of silently dropping the tail.
export function splitSections(text, max = MAX_RUNS) {
  const all = String(text || '')
    .split('\n')
    .reduce(
      (acc, line) => {
        if (line.trim() === '---') acc.push([]);
        else acc[acc.length - 1].push(line);
        return acc;
      },
      [[]],
    )
    .map((lines) => lines.join('\n').trim())
    .filter(Boolean);

  return { blocks: all.slice(0, max), truncated: Math.max(0, all.length - max) };
}

// A section may open with a line naming which wired images it uses -- `images: 2, 5`, the
// badge numbers sourceRoles already puts on the canvas, so what the user sees is what the
// directive means. Recognised on the FIRST non-empty line only: prose reading
// "images: three of them" halfway down a section must not silently reduce what that run
// sends. picks is null when there is no directive, meaning every image -- the behaviour
// every run had before directives existed, and what a text model that ignores the syntax
// falls back to. Only a pure list of positive integers counts: "Image: 3 women in a row"
// is an ordinary caption, and the repair prompt teaches the model this very keyword.
const PICKS_RE = /^images?\s*:\s*(\d+(?:[,\s]+\d+)*)\s*$/i;

export function parseImagePicks(block) {
  const lines = String(block || '').split('\n');
  const at = lines.findIndex((l) => l.trim() !== '');
  if (at === -1) return { text: '', picks: null };
  const m = lines[at].trim().match(PICKS_RE);
  const picks = m
    ? [
        ...new Set(
          m[1]
            .split(/[,\s]+/)
            .map((t) => Number(t))
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      ]
    : [];
  // A line is deleted only once it is confirmed to be a directive that named something
  // usable. The cost is asymmetric: a stray bookkeeping line left in a prompt is noise,
  // while a deleted description is a paid image of something nobody asked for.
  if (!picks.length) return { text: expandSlots(String(block).trim()), picks: null };
  return { text: expandSlots(lines.slice(at + 1).join('\n').trim()), picks };
}

// `[2]` -> "image 2". The repair prompt asks for bracket slots rather than plain
// numbers for one reason: a model rewriting "apply image 1's style to image 3" will
// happily copy "image 3" straight through, and that run only ever receives two
// attachments, so the number names nothing. A different token shape cannot be copied
// by reflex -- writing [2] is an act the model has to perform, not a word it can echo.
// The provider never sees the brackets; this turns them back into the phrasing image
// models are used to, right before the prompt is assembled.
export function expandSlots(text) {
  return String(text || '').replace(/\[(\d+)\]/g, 'image $1');
}

// One run's input_references. `picks` are directive numbers; null means every wired
// reference, which is what a section without a directive gets. Picked images come first,
// in the order the directive listed them -- that order is what "image 1" means inside that
// section's prose, since the provider only ever sees the attachments it is handed. Videos
// are appended untouched: an image output already warns that it sends and ignores them,
// and a directive numbers images only.
export function runReferences(nodes, edges, outputId, picks) {
  const { references } = bucketSources(nodes, edges, outputId);
  if (!picks) return { input_references: toReferences(references), used: null, dropped: [] };
  const images = references.filter((n) => n.type === 'image');
  const videos = references.filter((n) => n.type !== 'image');
  const used = picks.filter((n) => images[n - 1]);
  const dropped = picks.filter((n) => !images[n - 1]);
  // Every number named an image that is not wired. Falling back to all of them keeps a
  // garbled directive costing one text call to fix rather than a paid run with no
  // reference at all; `dropped` is what the caller reports.
  if (!used.length) return { input_references: toReferences(references), used: null, dropped };
  return {
    input_references: toReferences([...used.map((n) => images[n - 1]), ...videos]),
    used,
    dropped,
  };
}

// The whole of Free mode after the list text is in hand: split, read each section's
// directive, assemble prompts, pick each run's references. ONE seam, because the preview
// dialog derives its rows from this same call -- a preview that assembled its own view of
// the batch would eventually disagree with what gets sent, which is the one thing a
// preview must never do.
export function freeBatch(nodes, edges, outputId, sourceId, listText, max = MAX_RUNS) {
  const { blocks, truncated } = splitSections(listText, max);
  const all = blocks.map(parseImagePicks);
  // A section that was nothing but a directive has no text left, and running it would send
  // the shared context alone -- a paid generation of nobody's prompt. Dropped, and counted
  // like `truncated` so the caller can say how many.
  const parsed = all.filter((p) => p.text);
  const prompts = freeRunPrompts(nodes, edges, outputId, sourceId, parsed.map((p) => p.text));
  return {
    runs: prompts.map((prompt, i) => ({
      prompt,
      ...runReferences(nodes, edges, outputId, parsed[i].picks),
    })),
    truncated,
    empty: all.length - parsed.length,
    shared: freeShared(nodes, edges, outputId, sourceId),
  };
}
