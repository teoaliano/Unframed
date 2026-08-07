// Turn a preset fragment into nodes and edges ready for the canvas. Pure: the
// caller supplies the id minter and does the viewport placement, so this can be
// tested with plain assertions like the rest of the graph logic.
//
// Fragments use local placeholder ids. Every insertion mints fresh ones, then
// rewrites edge endpoints AND `@oldid` tokens inside prompt text — a preset whose
// scene prompt embeds its subject prompt must keep pointing at its own copy, not
// at whatever an earlier insertion (or the user) happens to call by that name.
const TOKEN_RE = /@([\w-]+)/g;

export function instantiateFragment(fragment, nextId) {
  const idMap = new Map(fragment.nodes.map((n) => [n.id, nextId()]));

  const nodes = fragment.nodes.map((n) => {
    const data = { ...n.data };
    if (typeof data.text === 'string') {
      // Whole tokens only: TOKEN_RE consumes the full run of word characters, so
      // rewriting @p1 can never chew the front off an unrelated @p10.
      data.text = data.text.replace(TOKEN_RE, (all, ref) =>
        idMap.has(ref) ? `@${idMap.get(ref)}` : all,
      );
    }
    return { ...n, id: idMap.get(n.id), position: { ...n.position }, data };
  });

  const edges = fragment.edges.map((e) => ({
    ...e,
    id: `e-${idMap.get(e.source)}-${idMap.get(e.target)}`,
    source: idMap.get(e.source),
    target: idMap.get(e.target),
  }));

  return { nodes, edges };
}

// Where the fragment's nodes should land so its bounding box centres on `centre`
// (a flow coordinate). Positions in fragments are relative to (0,0), but nothing
// requires them to start there, so this measures rather than assumes.
export function centerOffset(fragment, centre, nodeSize = { w: 300, h: 150 }) {
  const xs = fragment.nodes.map((n) => n.position.x);
  const ys = fragment.nodes.map((n) => n.position.y);
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) + nodeSize.w - Math.min(...xs),
    h: Math.max(...ys) + nodeSize.h - Math.min(...ys),
  };
  return {
    dx: centre.x - box.x - box.w / 2,
    dy: centre.y - box.y - box.h / 2,
  };
}
