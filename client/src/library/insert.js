import { migrateNodes } from '../graph/migrate.js';
import { stripRunMarkers } from '../graph/runMarkers.js';

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
  // Every preset reaches the canvas through here, bundled or saved by you, so this is
  // where a fragment written before the output split gets its node types brought up to
  // date. presets.json on disk is deliberately left alone: rewriting it means a
  // whole-array PUT, and that write path is the one place a stale read erases presets
  // that are still there. Migrating on the way out costs nothing and risks nothing.
  const source = migrateNodes(fragment.nodes);
  const idMap = new Map(source.map((n) => [n.id, nextId()]));

  const nodes = source.map((n) => {
    // The inbound half of the strip in save.js's selectionFragment, and the
    // only half that can help a preset ALREADY on disk: presets.json is never
    // rewritten, so a fragment saved before the outbound strip existed still
    // carries its markers, permanently, and this is the only path that sees
    // them. Left in, a stale video job polls an id OpenRouter has forgotten --
    // a 404 that pollVideo (client/src/api.js) reads as failure to reach our
    // own server, not as an answer -- so the node stays disabled forever. The
    // marker list lives in graph/runMarkers.js.
    const data = stripRunMarkers(n.data);
    if (typeof data.text === 'string') {
      // Whole tokens only: TOKEN_RE consumes the full run of word characters, so
      // rewriting @p1 can never chew the front off an unrelated @p10.
      data.text = data.text.replace(TOKEN_RE, (all, ref) =>
        idMap.has(ref) ? `@${idMap.get(ref)}` : all,
      );
    }
    const node = { ...n, id: idMap.get(n.id), position: { ...n.position }, data };
    // Membership is a reference too, and follows the same map. A parent that is not in
    // the fragment (a hand-edited preset, or one saved before save.js pulled members in
    // with their group) is dropped rather than left dangling: the server refuses a
    // member whose group does not exist, and the whole insertion would bounce.
    if (n.parentId) {
      if (idMap.has(n.parentId)) node.parentId = idMap.get(n.parentId);
      else delete node.parentId;
    }
    return node;
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
  // Members are measured by their box, not by themselves: their positions are relative
  // to the group and would drag the bounding box toward (0,0).
  const top = fragment.nodes.filter((n) => !n.parentId);
  const measured = top.length ? top : fragment.nodes;
  const xs = measured.map((n) => n.position.x);
  const ys = measured.map((n) => n.position.y);
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
