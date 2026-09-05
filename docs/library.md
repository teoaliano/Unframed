# The Library

Presets, saving your own, and the dialog's chrome. Read this before touching
`client/src/library/` or `server/presets.js`. Core rules are in `CLAUDE.md`.

## Presets are data, not code

`client/src/library/` holds presets shaped
`{id, name, type: flow|block, kind: image|video|text, summary, needs, fragment}`.

`instantiateFragment` in `library/insert.js` mints fresh ids via the shared counter
and rewrites edge endpoints *and* `@oldid` tokens — whole tokens only, so `@p1`
never clips `@p10`. It also runs `migrateNodes` over the fragment, which is how a
preset saved before a node-type change still inserts correctly. Inserted nodes are
plain copies with no link back to their preset. Tested in `resolve.test.js`.

Group membership is a reference too: `parentId` goes through the same id map, and a
member whose group is not in the fragment loses it rather than dangling — the server
refuses a member without its group, and the whole insertion would bounce. `centerOffset`
measures top-level nodes only, since a member's position is relative to its box. On the
way out, `selectionFragment` pulls a selected group's members in after it (React Flow
needs the parent first), and a member selected without its group is detached at its
absolute position. A saved group is how "a character" or "a product" lives in the
library: a name on a box, not a node type (`docs/superpowers/specs/2026-09-05-group-node-design.md`).
The whole round trip -- select a box, Add to library, insert it back with fresh ids and
its members still inside it -- is pinned in `resolve.test.js`. That is what makes a
reusable character or product a preset a user saves rather than a template we ship.

## Your own presets are the same data, on disk

Right-click → *Add to library* saves the selection through `library/save.js`:

- `selectionFragment` — the selected nodes, or the right-clicked one, plus only the
  edges wholly inside them. Shared with the node clipboard, which is why Copy works
  on an unselected right-clicked node.
- `presetFromSelection` — asks only for a name and a description and *derives* the
  two chips: several nodes is a `flow`, one is a `block`, and `kind` comes from the
  consuming node's **type** (`imageOutput` → image, and so on). Two more dropdowns
  would only let you contradict the graph you just selected. `flow` vs `block` counts
  **top-level** nodes: a group is one thing on the canvas whatever it holds, so a saved
  character is a block, not a three-node flow.
- `placeFragment` — moves an instantiated fragment to where `centerOffset` measured it
  should go, and only top-level nodes take the offset. A member's position is relative
  to its group, so offsetting one pushes it out of the box by exactly that much; being
  clamped to the parent's edge, the failure reads as a preset whose contents piled into
  a corner rather than as arithmetic. It is a function here rather than a line in
  `App.jsx` so `resolve.test.js` can pin it — which is how the bug was found.

They carry `source: 'user'`, get a *Custom* chip and a delete button, sort ahead of
the bundled ones, and otherwise go back in through `instantiateFragment` exactly like
a preset that ships with the app.

### The storage rule that matters

Storage is one `presets.json` at the root of `OUTPUT_DIR` — beside the project
folders, since a preset is yours and not a project's, and invisible to
`/api/projects`, which lists directories only — behind `GET`/`PUT /api/presets`.

**The PUT replaces the whole array, so every write re-reads the file first.**
Appending to a stale copy in React state, or to a swallowed failure, would erase
presets that are still on disk. That is also why there are no per-preset routes:
delete is a filter plus a PUT.

The read lives in `server/presets.js` rather than four lines in `index.js` precisely
so the rule can be asserted: `readPresets` returns `[]` **only** for `ENOENT`, and
throws on damaged JSON or any other read failure, since "unreadable" answered as
"empty" is what makes the next save erase the file. `listPresets` throws for the same
reason. `server/presets.test.js` (in `npm test`) fails if those two cases are ever
collapsed back together — verified by reverting the guard and watching it fail.

Not `localStorage`: one saved image node's base64 would exhaust the quota.

## The chrome is derived state, and the two views are one card

Search, the type and source filters, the sort and the 10-per-page slice are plain
array work over `[...userPresets, ...PRESETS]`, in that order — filter and sort see
every preset, and only the last step cuts the page, so "Newest" means the newest of
all of them and not of what happens to be on screen.

The page number is clamped to the last page rather than stored there (deleting the
last preset on the last page would otherwise show an empty one) and resets to 1 when
the result set changes. Chips are `Token`s from a single `CHIPS` table (icon + colour
per value), which is why there is no chip CSS.

Cards and list are two renderings, not one, because a card in a one-column grid is
still a card in a column. The list is `List` + `Item` — not `ListItem`, whose `label`
is a string, where `Item`'s takes a ReactNode so the chips sit on the name's line and
the description gets the row's full width. It is clamped to three lines by our own
CSS (a ReactNode `description` owns its clamping) with the full text in a native
`title`, and the row divider is one rule of ours too, since `hasDividers` only styles
`ListItem`.

The view choice is remembered in `localStorage` (`unframed:library-view`); the sort
is not, being a per-visit action. Sort is Newest / Oldest / A–Z / Z–A — each
direction its own option rather than a field plus an asc/desc toggle, since "Oldest"
says what it does where an arrow beside "Newest" would need decoding; the two
inverses come from a `flip` helper, not duplicated comparators. Sorting on a date is
possible because `presetFromSelection` stamps `savedAt`; `savedRank` treats an
undated preset of yours as newer than anything bundled, since everything you saved
postdates the catalogue — the alternative was decoding the timestamp back out of the
`user-<base36>` id, which is a puzzle rather than a field.
