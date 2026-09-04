# Group nodes

Designed 2026-09-05, in conversation. Status: approved; the engine half is this PR, the
canvas half (the container node itself and its interactions) is the next one. Prompted by
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

## The canvas (next PR)

A `GroupNode` container registered in `App.jsx` with the name row and one source handle;
Inputs menu entry; drag a node in (reparent, drop edges, position becomes relative) and
out (reparent to `null`, position becomes absolute); Ungroup; members render without
handles; Delete cascades and one undo restores. A **Character** template in the library
— an empty description prompt and image slots inside a named group — is how the turnkey
feel of PR #52's node comes back without the node. Verified in the browser, per
`CLAUDE.md`'s rule that node components have no tests.

## Left open, deliberately

- **Free mode's list source** (`findFreeSource`) does not look inside a wired group. A
  Free list lives in a text output or a prompt wired directly, as before.
- **A group's own badge.** Members carry their numbers; the group shows none in this
  design. Whether the box should summarise ("3 images") is a question for the canvas PR.
- **Selecting a group selects its members?** React Flow does not by default. Decide in
  the canvas PR, where it can be felt.
