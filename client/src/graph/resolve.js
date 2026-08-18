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
export const isReferenceable = (n) => n?.type === 'prompt' || isTextOutput(n);

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
  return substitute(node.data?.text, refs, [...stack, id]);
}

// Every source wired into one output, split by the role its mode gives them.
// The single home for that split: buildRequest sends from it and the input node
// badges read it, so what a node claims and what is sent cannot drift.
export function bucketSources(nodes, edges, outputId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const output = byId.get(outputId);
  const sources = edges
    .filter((e) => e.target === outputId)
    .map((e) => byId.get(e.source))
    .filter(Boolean)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));

  const media = sources.filter(
    (n) => (n.type === 'image' || n.type === 'video') && n.data?.dataUrl,
  );
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

// Build the generation request for a given output node id.
// Returns { prompt, input_references, frame_images }. frame_images is empty unless
// the output is a video node asking for a frame mode.
export function buildRequest(nodes, edges, outputId) {
  const refs = new Map(
    nodes.filter((n) => n.type === 'prompt' || isTextOutput(n)).map((n) => [n.id, n]),
  );
  const { sources, references, frames } = bucketSources(nodes, edges, outputId);

  const input_references = references.map((n) =>
    n.type === 'video'
      ? { type: 'video_url', video_url: { url: n.data.dataUrl } }
      : { type: 'image_url', image_url: { url: n.data.dataUrl } },
  );
  const frame_images = frames.map(({ node, frame_type }) => ({
    type: 'image_url',
    image_url: { url: node.data.dataUrl },
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
  if (!self || (self.type !== 'image' && self.type !== 'video') || !self.data?.dataUrl) return [];

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

// The text node feeding this output, if any — Free mode needs its result to know
// what to generate. Lowest Y wins, matching buildRequest's ordering, so "the text
// node" is a stable choice when several are wired in. Returns undefined when none
// are wired in.
export function findWiredTextNode(nodes, edges, outputId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter((e) => e.target === outputId)
    .map((e) => byId.get(e.source))
    .filter((n) => n && isTextOutput(n))
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))[0];
}

// One prompt per Free-mode block. The shared context is everything wired into the
// output EXCEPT the text node supplying the list — asking buildRequest for the graph
// minus that node (rather than subtracting its result from the joined prompt) is what
// keeps a blank line inside the result, or an @id reference to the list itself, from
// smuggling the whole list back in. Each block is appended after a blank line.
export function freeRunPrompts(nodes, edges, outputId, textNodeId, blocks) {
  // The list node stays in the graph with an empty result rather than being removed:
  // @its-id must resolve to nothing, and an absent node would now leave the token
  // itself in the prompt. Known-and-empty is the intent; unknown was a side effect.
  const shared = buildRequest(
    nodes.map((n) => (n.id === textNodeId ? { ...n, data: { ...n.data, result: '' } } : n)),
    edges,
    outputId,
  ).prompt;
  return blocks.map((b) => [shared, b].filter(Boolean).join('\n\n'));
}

// Split a text node's result into one block per run. The separator is a line that
// contains only "---", so a --- inside prose is left alone. `max` is the run cap;
// `truncated` lets the caller say "list had 14 items, running the first 10" instead
// of silently dropping the tail.
export function splitSections(text, max = 10) {
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
