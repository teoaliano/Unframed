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

  // Images (with a picture loaded) become the ordered references. Their position
  // in this array is the "image N" the user sees on the node and types in prompts.
  const references = sources
    .filter((n) => n.type === 'image' && n.data.dataUrl)
    .map((n) => ({ type: 'image_url', image_url: { url: n.data.dataUrl } }));

  const promptParts = [];
  for (const node of sources) {
    if (node.type !== 'prompt' && node.type !== 'text') continue;
    const text = resolveRef(node.id, refs, []).trim();
    if (text) promptParts.push(text);
  }

  return { prompt: promptParts.join('\n\n'), input_references: references };
}

// The reference number an image node will have when sent (1-based), or null if
// it isn't connected to an output / has no image. Kept here so the node badge and
// buildRequest agree on ordering. `nodes`/`edges` are the live React Flow arrays.
// Both output-family types (`output` and `text`) consume edges, so an image wired
// only into a text node still counts as connected.
export function imageRefNumber(nodes, edges, imageId) {
  const outputIds = new Set(
    nodes.filter((n) => n.type === 'output' || n.type === 'text').map((n) => n.id),
  );
  if (!outputIds.size) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const connected = new Map();
  for (const e of edges) {
    if (!outputIds.has(e.target)) continue;
    const n = byId.get(e.source);
    if (n && n.type === 'image' && n.data?.dataUrl) connected.set(n.id, n);
  }
  const ordered = [...connected.values()].sort(
    (a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0),
  );
  const idx = ordered.findIndex((n) => n.id === imageId);
  return idx === -1 ? null : idx + 1;
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
