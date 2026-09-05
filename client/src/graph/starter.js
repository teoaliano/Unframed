// The canvas's starting material: node ids, the per-type defaults a new node is
// minted from, and the three-node graph a first run opens with.
//
// Split out of App.jsx 2026-08-17 under CLAUDE.md's earns-its-own-tests rule.
// App.jsx is JSX, so plain `node` cannot import it and none of this could be
// tested at all while it lived there — and three of these DO have rules worth
// pinning: ids are @reference keys, so a reissued id silently captures someone
// else's reference; `slug` is a hand-kept copy of the server's slugify; and the
// starter graph's scene prompt references the subject prompt by id, which is the
// one feature a first-run canvas exists to demonstrate. Pinned in
// `resolve.test.js` — it is the only test file this directory has.
import { OUTPUT_DEFAULTS } from '../nodes/output/defaults.js';

// `nowheel` deliberately does NOT live here. It was on whole nodes until
// 2026-08-19, and React Flow honours the class for a node's entire subtree, so
// the wheel did nothing at all over an output node — no scroll-to-pan, no
// pinch, no Cmd+wheel zoom. It now sits on the scrolling textareas alone
// (PromptNode, TextOutputNode), which are the only things that need it: their
// `.astryx-textarea` is `overflow: auto` and user-resizable, so without it long
// text cannot be scrolled. Everywhere else on a node the canvas navigates.
// `className` is derived, so it goes after the spread — a value saved into an older
// graph must not stick around and shadow the current rule. `dragHandle` is set to
// undefined rather than left out for exactly that reason: every node written to
// graph.json before 2026-08-18 carries `dragHandle: '.xnode-head'`, and omitting the
// key here would let that stale value through, leaving old projects draggable only by
// their title bar while new nodes drag from anywhere. presets.json is never rewritten
// (docs/library.md), so for presets the split would be permanent. Undefined means "no
// handle" to React Flow, which is what makes the whole card the drag surface; the
// controls opt out individually with `nodrag`. See
// docs/superpowers/specs/2026-08-18-canvas-interaction-design.md.
const RESIZABLE_INPUT = new Set(['image', 'video', 'audio', 'prompt']);
// A page is free on both axes like a prompt, and starts large enough to read.
const PAGE_SIZE = { width: 480, height: 320 };

// EVERY node that reaches the canvas goes through this, without exception — a node
// handed straight to addNodes has no wrapper width, and an input node's Card is
// width: 100%, so its picture renders at its own natural pixel size (a 1024px image
// became a 1024px node; shipped 2026-08-19 in 82b966b, found 2026-08-20). The three
// output nodes' add-to-canvas buttons are the call sites that are easy to miss, since
// they mint nodes themselves rather than through App.jsx's addNode.
export const withDrag = (n) => ({
  ...n,
  dragHandle: undefined,
  className: undefined,
  // Every INPUT node is resizable from its edges (nodes/MediaResize.jsx), and its Card
  // is width/height: 100% — which needs a size on the node wrapper to resolve against.
  // So they start at the 240 the Card used to carry itself, and keep whatever a resize
  // has written since. Unlike the two above this is NOT derived: a resized size is the
  // user's, not a stale default.
  //
  // Height differs by type, and the difference is the whole reason this is not one
  // line. For MEDIA it is deliberately never set, here or by a resize: while it is
  // undefined the picture's own aspect ratio computes it, which is what makes a resize
  // keep the media's proportions exactly. A PROMPT has no ratio to keep, so both axes
  // are the user's and a height has to be seeded — before this it resized by a CSS
  // handle on the field itself (the old data.size + fieldResize.js), which is what the
  // 2026-08-20 node-anatomy redesign replaced with a border drag on the card.
  //
  // A GROUP is a box other nodes sit in, so it starts large enough to hold two of them
  // side by side and keeps both axes, like a prompt.
  width:
    n.type === 'group' ? n.width ?? 420
    : n.type === 'page' ? n.width ?? PAGE_SIZE.width
    : RESIZABLE_INPUT.has(n.type) ? n.width ?? 240
    : n.width,
  // Media is the DERIVED case, so its height is dropped rather than passed through: a
  // height saved by an older build, or by a hand-edited graph.json, would otherwise be
  // honoured forever and quietly letterbox the picture. Everything that is not a prompt
  // and not media has no wrapper size at all.
  height:
    n.type === 'prompt' ? n.height ?? 160
    : n.type === 'group' ? n.height ?? 280
    : n.type === 'page' ? n.height ?? PAGE_SIZE.height
    : undefined,
  // A member stays inside its box while dragged. Derived from parentId on every load
  // and add, like the two above, so nothing saved can disagree with the membership.
  extent: n.parentId ? 'parent' : undefined,
  // React Flow's in-gesture flag, dropped for the same reason as the two above and with
  // a worse failure: `getNodesInside()` is the only geometry test a box selection runs,
  // and it ends with `if (isVisible || node.dragging)`. A node carrying a stale `true`
  // is therefore inside EVERY rectangle, wherever you draw it -- which reads as the
  // canvas you see not matching the one being selected. It reaches graph.json because
  // autosave writes the node objects as they are, so a save landing mid-drag persists
  // it and every later load restores it. App.jsx clears the in-memory case; see
  // clearDragging below.
  dragging: undefined,
});

let counter = 100;
export const nextId = () => String(counter++);
// ponytail: keep counter-issued ids from colliding with ids in a loaded graph,
// since ids are now reference keys.
export const bumpCounter = (nodes) => {
  counter = Math.max(counter, ...nodes.map((n) => parseInt(n.id, 10)).filter(Number.isFinite)) + 1;
};

// Same rule as the server's slugify, so the name the client tracks matches the
// folder the server writes. ponytail: kept in sync by hand; two call sites.
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);

// The starting data for each node type, in one place: the add menu and the
// keyboard shortcuts both mint from it, so a new node is the same node wherever
// you asked for it.
export const NEW_NODE = {
  prompt: { text: '' },
  // The name is what an @ tag shows for the group; the id stays the reference key.
  group: { name: '' },
  image: { fileName: '', dataUrl: '' },
  video: { fileName: '', dataUrl: '' },
  audio: { fileName: '', dataUrl: '' },
  imageOutput: OUTPUT_DEFAULTS.imageOutput,
  videoOutput: OUTPUT_DEFAULTS.videoOutput,
  textOutput: OUTPUT_DEFAULTS.textOutput,
  audioOutput: OUTPUT_DEFAULTS.audioOutput,
  page: { file: '', title: '', fileName: '' },
};

// A small starter graph that demonstrates the @id reference: the scene prompt
// embeds the subject prompt. The ids come from the same counter every other node
// draws from, so a starter node looks like one you added yourself — hand-written
// ids like "p-scene" implied a naming scheme the app doesn't actually have.
const SCENE_ID = nextId();
const SUBJECT_ID = nextId();
const OUTPUT_ID = nextId();

export const initialNodes = [
  {
    id: SCENE_ID,
    type: 'prompt',
    position: { x: 40, y: 60 },
    data: { text: `A @${SUBJECT_ID} on a windswept cliff at golden hour, cinematic, 35mm` },
  },
  {
    id: SUBJECT_ID,
    type: 'prompt',
    position: { x: 40, y: 320 },
    data: { text: 'lone red fox' },
  },
  {
    id: OUTPUT_ID,
    type: 'imageOutput',
    position: { x: 460, y: 120 },
    data: { ...OUTPUT_DEFAULTS.imageOutput, runs: 1 },
  },
].map(withDrag);

export const initialEdges = [{ id: `e-${SCENE_ID}`, source: SCENE_ID, target: OUTPUT_ID }];

// The same flag as withDrag's, stuck without a save or a load in between: a drag whose
// end never arrived. d3-drag clears `dragging` from its `end` handler, and `end` needs a
// mouseup on the window -- so switching macOS spaces or apps mid-drag, or any gesture
// the OS takes over, leaves the flag true with nothing left to clear it. App.jsx sweeps
// on pointercancel and window blur, the two events that mean "that gesture is over".
//
// Returns the SAME array when there is nothing to clear, and that is load-bearing rather
// than tidy: those events fire every time you click away from the window, and a fresh
// array from each one would push an undo entry and trigger an autosave. Untouched nodes
// keep their identity too, so React Flow's own `checkEquality` reuses their internals.
export const clearDragging = (nodes) =>
  nodes.some((n) => n.dragging)
    ? nodes.map((n) => (n.dragging ? { ...n, dragging: false } : n))
    : nodes;
