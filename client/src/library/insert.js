import { migrateNodes } from '../graph/migrate.js';

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
    // Same two in-flight markers selectionFragment strips on the way out, dropped
    // again on the way in — and for a reason the outbound strip cannot cover.
    // presets.json is never rewritten, so a preset saved before that strip existed
    // still carries its job id, permanently, and this is the only path that sees it.
    // Left in place it is not self-correcting: the pasted node polls, and the poll
    // only ends well if THIS machine's store still holds that job as `done`. Once
    // the record has pruned (seven days) or the preset has travelled to another
    // machine or output folder, the route falls through to OpenRouter, gets a 404,
    // and answers 404 — which pollVideo (client/src/api.js) treats as a transient
    // failure to reach our own server, not as an answer. So the node polls for its
    // full 15-minute window, re-arms every two minutes after that, and stays
    // disabled forever with only "Forget this job" as the way out.
    const data = { ...n.data, job: undefined, running: undefined };
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
