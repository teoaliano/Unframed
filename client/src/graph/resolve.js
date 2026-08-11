// Pure graph logic. No React, no network — just turn the node/edge graph into
// a single generation request. This is the only part with real logic; everything
// else is UI wiring.

// @ref references another PROMPT or TEXT node by its id (word chars + hyphens).
// Images are not referenced this way — they are sent as an ordered array and named
// positionally ("image 1", "image 2") which the user types as plain text.
const TOKEN_RE = /@([\w-]+)/g;

function substitute(text, refs, stack) {
  return (text || '').replace(TOKEN_RE, (_, raw) => {
    const ref = raw.trim();
    if (refs.has(ref)) return resolveRef(ref, refs, stack);
    return ''; // unknown ref -> nothing
  });
}

// Resolve one referenced node to text. Prompt nodes substitute recursively; a text
// node's model output is inserted literally — re-scanning it for @tokens would let
// model output pull in arbitrary prompts, and makes cycles unresolvable.
// Throws on circular prompt references (A -> B -> A).
function resolveRef(id, refs, stack) {
  const node = refs.get(id);
  if (node.type === 'text') return node.data?.result || '';
  if (stack.includes(id)) {
    throw new Error(`Circular reference: ${[...stack, id].join(' -> ')}`);
  }
  return substitute(node.data?.text, refs, [...stack, id]);
}

// Build the generation request for a given output node id.
// Returns { prompt, input_references }.
export function buildRequest(nodes, edges, outputId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Both prompt and text nodes can be pulled in with @id.
  const refs = new Map(
    nodes.filter((n) => n.type === 'prompt' || n.type === 'text').map((n) => [n.id, n]),
  );

  // Every node wired into this output node, top-to-bottom for predictable order.
  const sources = edges
    .filter((e) => e.target === outputId)
    .map((e) => byId.get(e.source))
    .filter(Boolean)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));

  // Images and videos (with media loaded) become the ordered references, mixed in
  // Y-order. A node's position among its own kind is the "image N" / "video N" the
  // user sees on the node and types in prompts — two independent counters, because
  // that's how the badges number them.
  const references = sources
    .filter((n) => (n.type === 'image' || n.type === 'video') && n.data.dataUrl)
    .map((n) =>
      n.type === 'video'
        ? { type: 'video_url', video_url: { url: n.data.dataUrl } }
        : { type: 'image_url', image_url: { url: n.data.dataUrl } },
    );

  const promptParts = [];
  for (const node of sources) {
    if (node.type !== 'prompt' && node.type !== 'text') continue;
    const text = resolveRef(node.id, refs, []).trim();
    if (text) promptParts.push(text);
  }

  return { prompt: promptParts.join('\n\n'), input_references: references };
}

// The reference numbers an image/video node will be sent as, one per node consuming
// it (1-based, ascending, deduplicated). Empty when it has no media or feeds nothing.
// Numbering is per consumer because that is how buildRequest sends them: an image can
// be image 1 to a text node and image 2 to an output node at the same time. It is
// also per kind — images and videos count independently, so "image 1" and "video 1"
// can coexist on one consumer. Kept here so the node badge and buildRequest cannot
// disagree. `nodes`/`edges` are the live React Flow arrays.
export function imageRefNumbers(nodes, edges, nodeId, kind = 'image') {
  const self = nodes.find((n) => n.id === nodeId);
  if (!self || self.type !== kind || !self.data?.dataUrl) return [];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const consumers = nodes.filter((n) => n.type === 'output' || n.type === 'text');
  const ranks = new Set();

  for (const consumer of consumers) {
    const sameKind = edges
      .filter((e) => e.target === consumer.id)
      .map((e) => byId.get(e.source))
      .filter((n) => n && n.type === kind && n.data?.dataUrl)
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));
    const idx = sameKind.findIndex((n) => n.id === nodeId);
    if (idx !== -1) ranks.add(idx + 1);
  }

  return [...ranks].sort((a, b) => a - b);
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
    .filter((n) => n && n.type === 'text')
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))[0];
}

// One prompt per Free-mode block. The shared context is everything wired into the
// output EXCEPT the text node supplying the list — asking buildRequest for the graph
// minus that node (rather than subtracting its result from the joined prompt) is what
// keeps a blank line inside the result, or an @id reference to the list itself, from
// smuggling the whole list back in. Each block is appended after a blank line.
export function freeRunPrompts(nodes, edges, outputId, textNodeId, blocks) {
  const shared = buildRequest(
    nodes.filter((n) => n.id !== textNodeId),
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
