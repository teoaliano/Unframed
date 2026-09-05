# Group nodes

Designed 2026-09-05, in conversation. Status: approved and implemented the same day, in
one PR — engine and canvas together, deliberately: a merged half would put a node type on
`main` that nothing can create. Prompted by
PR #52, an outside contribution that added a `character` node holding a description plus
reference images. The idea was right and the shape was not; this is the shape.

## What a group is

A **group** is a box on the canvas that holds input nodes — prompts, images, videos — and
stands for them: it has the one handle, so wiring the group wires its contents, and it has
the one id, so `@group` in a prompt is its prompts' text. It has a name, shown by the `@`
tag and the name row, and nothing else of its own.

A member is an ordinary node with `parentId` set and a position relative to the box
(React Flow's own container model). Nothing about a member changes except that it loses
its handle. There is still exactly one way to hold an image on the canvas.

"Character", "product", "device", "outfit" are what a user *calls* a saved group in the
library, not node types. A new kind costs a name, not a PR.

## Decisions, and why

- **A container node, not a dedicated `character` node.** The character node invented a
  second shape for an image (`data.images[]` beside the `image` node's `data.file`), and
  every code path that touches images — the size cap, resize, the `project-file:` marker,
  run markers, copy paths — would have had two shapes to handle forever. PR #52 had to
  synthesise "virtual image nodes" inside `bucketSources` to cope. A group *of* image
  nodes has no second shape.
- **The group has the handle; members lose theirs.** One way to send a thing. A member
  with its own handle beside the group's is two ways to send one image, and the wires
  stop telling the truth. `canSource` (`bulkWire.js`) returns false for any node with a
  `parentId`; the server refuses nothing here, because the client is the only thing that
  draws handles.
- **Contiguous, not interleaved.** A wired group takes one slot in the top-to-bottom
  source order at its own position; its members fill that slot in their order inside
  the box. The alternative — sort members by absolute position among the outside nodes
  — needs parent-plus-child arithmetic for every member and cannot be read off the
  canvas. "That box is image 2 and 3" can.
- **Text by mention, media by wire — unchanged.** `CLAUDE.md`'s "`@id` composes prompts,
  not edges" holds exactly. `@group` substitutes its prompt members joined by `\n\n`, the
  join an output uses; a mention never attaches a member image. PR #52 attached images on
  mention "to save redundant wires", which made an `@` token spend money on references
  the canvas showed no wire for. Rejected: the wires are what you look at to see what
  you are paying for.
- **No injected prompt text.** PR #52 prepended "Keep character appearance, face, and
  identity from images 1 and 2 unchanged." to the substituted text, once per mention,
  wherever the token sat — mid-sentence, usually. A user who wants that writes a prompt
  node inside the group saying so, in their words, visible on the canvas.
- **Deleting a group deletes its members.** A member's position means nothing without
  its box; a delete that left the contents behind would scatter them at their relative
  coordinates over the top-left of the canvas. The journal makes the whole box one undo
  step, and node deletion never deletes media files, so cascade is the safe default. An
  explicit Ungroup action is the other intent.
- **Dragging a wired node into a group drops its edges.** Re-pointing them to the group
  is clever and invisible — the one thing on the canvas that would happen without being
  drawn. Removal is visible, and the wires stay truthful.
- **No nesting.** A group refuses a `parentId`. One level to resolve, everywhere.
- **⌘G collapses the members' wires onto the box; dragging one node into an existing
  group drops its wire.** Decided 2026-09-05 after the rule below was written, because
  wrapping is not the case the rule was written for. Wrapping moves nothing, so severing
  the wires of three images that already feed an output would destroy work the user never
  touched; the box takes one wire per target instead, drawn immediately. Dragging a
  single node into a group that already exists is different: that group may be wired to
  something else, and collapsing would widen what feeds that output from one node to the
  whole box — a silent increase in what is sent and paid for. The asymmetry is the
  principle, not an exception: **collapse when the group is being created from exactly
  these nodes, drop when joining a group that already means something.** Grouping a
  partially-wired selection does change what is sent, since a group sends all of it;
  that is visible the instant it happens, because badges and the request both read
  `bucketSources`.
- **Video is in.** Members flatten into the same media list as any wired media, so a
  frame mode takes the first ones and badges the rest with an em dash — the same rule
  as wiring ten videos into first/last. Nothing new to decide.
- **Parent before members in the node array**, maintained by the ops. React Flow 12
  resolves a child against the parents it has already seen, warns, and renders an
  orphan at its relative position otherwise. `reparentNode` moves a node to just after
  its group when it was ahead of it (and its inverse puts it back); `addNode` bumps an
  index that would land a member ahead of its group; `removeNode`'s cascade inverse
  restores in ascending index order, so each member finds its group already there.

## The engine (this PR)

**`server/graph.js`** — one new op and two widened ones:

- `reparentNode { id, parentId, position, index? }`: into a group, out of one (`null`),
  or between two. Position travels with it because its frame changes — a node that
  changed parent without changing coordinates would jump on screen. Entering a group
  drops the node's edges (inverse restores them). Rejects: no such group, target is not
  a group, member would be an output or a group, self, missing position.
- `addNode` validates `parentId` the same way and never inserts a member ahead of its
  group.
- `removeNode` on a group removes members and every edge touching any of them; the
  inverse is one batch, nodes in ascending index order, then edges.

**`client/src/graph/ops.js`** — `diffGraphs` emits `reparentNode` (carrying the position)
instead of `moveNode` when `parentId` changed, and does not send `removeNode` for a
member whose group is also going — the server cascades, and a bounce would fail the
whole batch.

**`client/src/graph/resolve.js`** — `isGroup`, `membersOf(nodes, groupId)` (relative-Y
order), `isReferenceable` includes groups; `bucketSources` expands a wired group in place;
`resolveRef` on a group joins its prompt members; one `referenceMap` helper replaces the
three copies of the referenceable filter. `sourceRoles` needed no change: member media
sit in `references` under their own ids.

**`client/src/graph/bulkWire.js`** — `canSource` is false for a member.

**`client/src/graph/starter.js`** — `NEW_NODE.group = { name: '' }`; `withDrag` seeds a
group at 420×280 keeping both axes, and derives `extent: 'parent'` from `parentId` on
every load and add so nothing saved can disagree with membership.

**`client/src/library/insert.js`, `save.js`** — `instantiateFragment` remaps `parentId`
through the id map and drops one whose group is not in the fragment; `centerOffset`
measures top-level nodes only. `selectionFragment` pulls a selected group's members in
(parent first), and a member taken without its group is detached at its absolute position.

**`server/agentTools.js`** — `canvas_read` reports `inGroup` on members and `name` on a
group, and says positions in a group are relative rather than converting them.

### Testing

Every rule above is pinned under bare `node`: `server/graph.test.js` (each op
round-trips through its inverse, each rejection), `client/src/graph/ops.test.js`
(reparent vs move, cascaded removes), `bulkWire.test.js` (members are not sources),
`resolve.test.js` (contiguous expansion and badges, `@group` text and cycle, frame modes,
library remap and detach, `withDrag`). Nothing here is visible in the browser yet.

## The canvas

**`client/src/graph/grouping.js`** — the pure half, under the earns-its-own-tests rule,
and it earns it twice: wrapping converts every member's ABSOLUTE position into one
relative to the new box (backwards puts the contents off screen the first time anyone
groups nodes away from the origin), and the edge rule above is a money rule.
`groupSelection` returns the box, the re-homed members and the new edge set;
`ungroup` is its inverse and restores absolute positions exactly, so group-then-ungroup
leaves the canvas as it was. `absolutePosition` walks `parentId`, so a node already in a
group is measured — and re-homed — by where it *looks*. Sizes fall back when absent,
because media deliberately has no height of its own (`withDrag`).

**`client/src/nodes/GroupNode.jsx`** — the box and nothing else: its members are separate
nodes React Flow positions against it. **The name is the node's one label.** The first
build showed a "GROUP" tab *and* a name field inside the box, which said the same thing
twice and spent the box's top strip on a form; the tab now reads the name, exactly as an
image node's tab reads its medium. Renaming is in place — double-click the tab, or F2
while selected. Not ⌘R, the other candidate: it is the browser's reload, so taking it
would leave a user with a box selected unable to refresh the page. The editing input is
`nodrag` so a caret can be placed, stops Backspace from reaching the canvas (which would
delete the box you are naming), and abandons its draft on Escape. Resizable from any
edge via `MediaResize`, which gained a per-type `max` — a box wrapping three images
starts wider than the 900 ceiling a single node has.

**`App.jsx`** — `nodeTypes` registration, an Inputs-menu entry for an empty box, ⌘G /
⌘⇧G, and Group / Ungroup in the right-click menu's Edit section, each offered only when
it would do something. `groupSelected` computes from the current arrays and writes with
two plain setters rather than nesting `setEdges` inside a `setNodes` updater: React runs
updaters twice under StrictMode, so a side effect in there fires twice — the same trap
`addNode`'s minted id documents. Selection lands on the new box, not its contents, or the
next drag pulls them straight back out.

**The three input node components** render their handle only when `parentId` is absent.

### Fixed after the first browser pass

Four things the tests could not have caught, three of them cosmetic and one not:

- **Ungroup deleted the contents.** `diffGraphs` emitted the group's `removeNode` before
  the `reparentNode` ops freeing its members, and the server's `removeNode` cascades — so
  the members were deleted server-side, the cascade came back over SSE and emptied the
  tab, and the reparents that followed bounced as "no node". A member escaping a group
  that is being removed is now reparented FIRST, and `ops.test.js` pins the order (the
  test fails against the old ordering, verified by reverting it).
- Groups could not be resized. `MediaResize` now takes a per-type `max`.
- Two labels for one thing, fixed as described above.
- No selection border: the box is not an `.astryx-card`, so the `.selected` rules did not
  reach it. It now takes the same accent border and inset ring, and goes solid as well as
  accent — a dashed accent border at 1px is nearly invisible at low zoom, which is
  exactly when you need to see what is selected.

### Left for a follow-up

Dragging a node into or out of an existing box by dragging it. ⌘G and Ungroup cover
making and unmaking a group, which is the whole loop; `reparentNode` already supports the
drag case, so it is UI work only. Also the **Character** template in the Library — an
empty description prompt and image slots inside a named group — which is how the turnkey
feel of PR #52's node comes back without the node.

## Left open, deliberately

- **Free mode's list source** (`findFreeSource`) does not look inside a wired group. A
  Free list lives in a text output or a prompt wired directly, as before.
- **A group's own badge.** Members carry their numbers; the group shows none in this
  design. Whether the box should summarise ("3 images") is a question for the canvas PR.
- **Selecting a group selects its members?** React Flow does not by default. Decide in
  the canvas PR, where it can be felt.
