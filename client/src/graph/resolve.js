// Pure graph logic. No React, no network — just turn the node/edge graph into
// a single generation request. This is the only part with real logic; everything
// else is UI wiring.

// @ref references another PROMPT node by its id (word chars + hyphens). Images
// are not referenced this way — they are sent as an ordered array and named
// positionally ("image 1", "image 2") which the user types as plain text.
const TOKEN_RE = /@([\w-]+)/g;

function substitute(text, promptsById, stack) {
  return (text || '').replace(TOKEN_RE, (_, raw) => {
    const ref = raw.trim();
    if (promptsById.has(ref)) return resolvePrompt(ref, promptsById, stack);
    return ''; // unknown ref -> nothing
  });
}

// Resolve one prompt node's text. Throws on circular references (A -> B -> A).
function resolvePrompt(id, promptsById, stack) {
  if (stack.includes(id)) {
    throw new Error(`Circular reference: ${[...stack, id].join(' -> ')}`);
  }
  return substitute(promptsById.get(id).data.text, promptsById, [...stack, id]);
}

// Build the generation request for a given output node id.
// Returns { prompt, input_references }.
export function buildRequest(nodes, edges, outputId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const promptsById = new Map(
    nodes.filter((n) => n.type === 'prompt').map((n) => [n.id, n]),
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
    if (node.type === 'prompt') {
      const text = resolvePrompt(node.id, promptsById, []).trim();
      if (text) promptParts.push(text);
    }
  }

  return { prompt: promptParts.join('\n\n'), input_references: references };
}

// The reference number an image node will have when sent (1-based), or null if
// it isn't connected to an output / has no image. Kept here so the node badge and
// buildRequest agree on ordering. `nodes`/`edges` are the live React Flow arrays.
export function imageRefNumber(nodes, edges, imageId) {
  const outputIds = new Set(nodes.filter((n) => n.type === 'output').map((n) => n.id));
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
