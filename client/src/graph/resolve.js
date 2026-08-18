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
  const refs = new Map(
    nodes.filter((n) => n.type === 'prompt' || isTextOutput(n)).map((n) => [n.id, n]),
  );
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
