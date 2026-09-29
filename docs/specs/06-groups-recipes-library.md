# 06 · Groups, recipes and the library

Depends on: 01, 02, 03, 04, 05

## Problem Statement

A person who builds the same thing over and over (a character, a product, a look) has to reselect the same prompts and pictures for every run, retype the same model and settings in the composer, and has nowhere to keep a setup for next week or for another project. The canvas from spec 02 can hold shapes, and specs 03 to 05 can run a selection, but nothing lets a set of shapes keep a name, nothing lets that name stand for its text inside another prompt, nothing lets a setup remember how it should be generated, and nothing carries a setup from one project to another.

## Solution

Three pieces, each built on the one before.

1. **Groups.** A group is tldraw's frame, extended. It is a box with a dashed border whose label is its `@id`. Its members are prompts, images, videos and marks. Selecting the box selects its contents for a run: the members take one slot in the top-to-bottom order, in their own order inside the box. Writing `@character` in a prompt pulls in the group's prompt text and never attaches its pictures. Cmd-G wraps a selection in a new group, Cmd-Shift-G takes the box away, renaming rewrites every reference in the same undo step, and deleting the box deletes its contents as one step.
2. **Recipe groups.** A group can also hold standing settings: the medium, the model, the parameters and the runs (including Free). Its label then shows a chip such as `gpt-image-2 · 1024² · ×3`, its toolbar Generate runs with those settings in one click, and the composer opens on them. The person saves, updates and clears the recipe from the composer.
3. **The library.** A preset is a saved group: the box, its members and its recipe if it has one. The person saves a selection with "Add to library", browses presets in the Library dialog (search, sort, view, filters, pages), inserts one into any project with fresh ids and rewritten references, and deletes their own. Two system presets ship with the app. Presets live in one `presets.json` at the root of the output folder, under a write rule that can never erase a preset still on disk.

## User Stories

Groups

1. As a person, I want to wrap the selected shapes in a named box with Cmd-G, so that a set I keep reusing becomes one thing on the canvas.
2. As a person, I want the new box to sit around its contents with room for the label, so that nothing moves when I group it.
3. As a person, I want the selection to land on the new box rather than its contents, so that my next drag moves the box and does not pull the contents out.
4. As a person, I want Cmd-Shift-G to remove the box and leave its contents exactly where they were on screen, so that grouping and ungrouping is lossless.
5. As a person, I want to make an empty group from the add menu or with tldraw's frame tool, so that I can build a set by dropping shapes into it.
6. As a person, I want to drag a prompt, image, video or mark into a box and out again, so that membership follows what I see.
7. As a person, I want a page, a motion or another group to refuse to go inside a box, so that groups stay one level deep and hold only material a run can use.
8. As a person, I want the box's label to read its `@id`, so that the name I see is the token I type.
9. As a person, I want to rename a group by double-clicking its label or pressing F2, so that I can name it in place.
10. As a person, I want a typed name like "Red Fox" to become `red-fox`, so that the name is always something a prompt can reference.
11. As a person, I want a name already in use to get a `-2` suffix instead of being refused, so that renaming never blocks me.
12. As a person, I want Escape to abandon a rename and Backspace inside the field to edit text rather than delete the box, so that a rename is safe to start by accident.
13. As a person, I want every `@old` reference in my prompts rewritten to `@new` when I rename, in the same undo step, so that undo never leaves prompts pointing at nothing.
14. As a person, I want deleting a group to delete its members as one undo step, so that its contents are not scattered over the canvas.
15. As a person, I want selecting a group to select its contents for a run, so that one click on the box gives me the whole set.
16. As a person, I want a group's members to occupy one slot in the top-to-bottom order, in their order inside the box, so that "that box is image 2 and 3" reads off the canvas.
17. As a person, I want the toolbar hint to read `@character` instead of a count when I select one group, so that the set I am about to use is named.
18. As a person, I want `@character` in a prompt to become the group's prompt text, joined the way a run joins prompts, so that I can describe a character once and use it everywhere.
19. As a person, I want `@character` never to attach the group's pictures, so that a mention cannot spend money on references I did not select.
20. As a person, I want a group to appear in the `@` mention menu and in "Copy @id", so that I can reference it like a prompt.
21. As a person, I want Agent on a group to send everything inside it, so that the agent sees the same set a run would.
22. As a person, I want pasting a group whose name is taken to arrive with a suffixed name, so that paste never steals an existing reference.

Recipe groups

23. As a person, I want to save the composer's current medium, model, parameters and runs onto a selected group, so that the box remembers how it should be generated.
24. As a person, I want a group with a recipe to show a chip like `gpt-image-2 · 1024² · ×3` on its label, so that I can tell a recipe group from a plain one at a glance.
25. As a person, I want the toolbar's Generate on a recipe group to run with its recipe in one click, so that "make another one of these" costs one click.
26. As a person, I want the button to say how many outputs it will make, so that I know what a click spends.
27. As a person, I want a Free recipe to stop at the final prompt step before it spends, so that a recipe keeps the confirm step Free always has.
28. As a person, I want a Recipe button and a click on the chip to open the composer on the group's recipe, so that I can run a variation without retyping.
29. As a person, I want changes I make in that composer to stay one-off until I choose "Update recipe", so that trying a variation does not silently rewrite the box.
30. As a person, I want to clear a recipe from the composer or the context menu, so that a recipe group can go back to being a plain group.
31. As a person, I want saving, updating and clearing a recipe to be one undo step each, so that Cmd-Z takes back exactly that change.
32. As a person, I want a recipe to apply when I select its group together with loose shapes, so that I can feed my own prompt into a saved setup.
33. As a person, I want the results of a recipe run to land beside the box and not inside it, so that the next run of the box does not include its own outputs.

The library

34. As a person, I want to right-click a group and choose "Add to library", so that I can keep it for other projects.
35. As a person, I want "Add to library" on loose shapes to save them as a group named after the preset, so that I do not have to group them first.
36. As a person, I want the save dialog to ask only for a name and a description, so that saving is quick and the rest is read from the canvas.
37. As a person, I want the dialog to tell me what it will save, so that I know whether the recipe goes with it.
38. As a person, I want a clear message when I leave the name empty or the save fails, so that I know what to fix.
39. As a person, I want a toast when the preset is saved, so that I know it worked.
40. As a person, I want a Library dialog with search, sort, view, type and source filters and pages of 10, so that I can find a preset among many.
41. As a person, I want my card or list choice remembered on this machine, across relaunches of the app, so that the dialog opens the way I like it.
42. As a person, I want to filter by Recipes and Groups, and by Custom and System, so that I can narrow to what I need.
43. As a person, I want each preset to show chips for what it is, what it makes and whose it is, so that I can scan the list before reading it.
44. As a person, I want Add to place the preset at the centre of my view with fresh ids, so that it never collides with what is already there.
45. As a person, I want a saved group's name to come back as its name, suffixed only if taken, so that a saved `@character` is still `@character`.
46. As a person, I want references between the preset's own prompts rewritten to the new copies, so that the preset points at itself and not at my shapes.
47. As a person, I want pictures in a preset copied into the project I insert it into, so that the inserted shapes show their pictures in any project.
48. As a person, I want a preset whose picture has since been deleted to arrive with an empty image and a note, so that nothing fails silently.
49. As a person, I want to delete my own presets after a confirmation, so that the library stays tidy and I do not delete one by accident.
50. As a person, I want system presets to have no delete button, so that I cannot remove what ships with the app.
51. As a person, I want the library to re-read my presets every time I open it, so that a preset saved in another tab shows up without a reload.
52. As a person, I want a damaged `presets.json` to be reported and never overwritten, so that one bad file never costs me every preset.
53. As a person, I want the Layerize and Prose to JSON presets available from the start, so that I have working examples to learn from.
54. As a maintainer, I want every write to `presets.json` to re-read the file first and replace it whole, so that a stale copy can never erase presets still on disk.
55. As a maintainer, I want entries in `presets.json` that this version does not understand to be kept on every write, so that spec 11 can read old presets from the same file later.

## Implementation Decisions

### Vocabulary used here

"Member" means a shape whose parent is a group. "Groupable" means a shape that may be a member: a prompt (including a text result), an image, a video or a mark. A page, a motion and a group are not groupable.

### Modules

- **Group rules** (domain). Pure functions over plain shape descriptions (id, kind, `@id`, bounds, parent, text). Interface:
  - `slugName(typed)`: the rename slug.
  - `uniqueName(wanted, taken)`: the suffix rule.
  - `renamePlan(shapes, from, to)`: the list of prompt text rewrites a rename needs.
  Hides: the token pattern and the suffix loop. The wrap geometry (`wrapBox`) and the allowed-member rule are spec 02's; the expansion of a group in a run and what `@group` resolves to are spec 03's selection to request and reference resolver. This spec calls them and does not restate them.
- **Recipe rules** (domain). `recipeChip(recipe)` (the label text), `recipeEquals(a, b)`, and `recipeFromTray(tray)` / `trayFromRecipe(recipe)` so the composer and the group speak one shape. The schema is spec 03's `GroupRecipe`. Hides: the chip's formatting rules.
- **Preset rules** (domain, deep). `presetFromSelection(content, {name, summary})` derivation, `instantiate(preset, taken, mint)` (fresh ids, `@id` remap, whole-token text rewrite, name suffixing), `placeAt(bounds, centre)`, and `libraryView(presets, {query, type, source, sort, page})` (filter, sort, paginate, clamp). Hides: rank rules for undated presets, the page size, the order of filter then sort then slice.
- **Preset store** (engine). Owns `presets.json`. Interface: three RPC methods (below). Hides: the read rule, the whole-array write, the serialised write queue, preservation of unknown entries.
- **Preset media copier** (engine). One RPC method that copies files named by a preset into the target project. Hides: sidecar writing, missing-file handling.
- **Group shape** (web). What this spec adds to spec 02's group: the rename field, the F2 binding and the recipe chip. An adapter over tldraw's frame behaviour, not a new shape type.
- **Group commands** (web). The context menu entries this spec adds, the toolbar variant for recipe groups, and the composer's recipe line. Thin: each calls the domain rules and writes to the editor inside one history step.
- **Library UI** (web). The Library button, the Library dialog, the "Add to library" dialog, the delete confirmation, insertion.

### Groups

Spec 02 owns the group shape: its look and label, membership and the child veto, Cmd-G and the context menu's Group, Cmd-Shift-G and Ungroup, the frame tool and the add menu's empty group, and delete taking the members with it as one undo step. This spec builds on that and adds rename, the naming rules for pasted groups, and recipes. A group holds its `@id` as its name, the way spec 02 stores it; the tldraw shape id is separate and never shown, so renaming never touches parent links.

**Rename.** Double-clicking the label, or F2 while exactly one group is selected, opens an inline field in the label's place. The field shows a fixed `@` then the current name, fully selected, with accessible label "Group name". Enter or blur commits; Escape abandons the draft; every other key stays in the field (Backspace edits the name and never deletes the box). Commit:
1. The typed text goes through spec 01's slug rule.
2. If the slug is empty or equals the current name, nothing changes.
3. If the slug is taken by any `@id` on the canvas (prompts, text results, groups), `-2`, `-3` and so on is appended until it is free.
4. The group's `@id` changes, and every prompt shape whose text contains the whole token `@old` has it rewritten to `@new`. A token is `@` followed by the longest run of word characters and hyphens, so renaming `fox` never touches `@fox-2` or `@foxes`. Text results are not rewritten: their text is a model's answer, substituted literally and never scanned for tokens. A result's recipe is a record of a past run and is never rewritten.
5. The rename and all of step 4's rewrites are one undo step.
F2 is used rather than Cmd-R because Cmd-R reloads the page.

**Pasting a group** (extends spec 02's paste). A pasted group whose `@id` is a name keeps it, suffixed by the rule above if taken; a group whose `@id` is a minted one gets a fresh minted `@id`. References inside the pasted prompts to the pasted group are rewritten to its new `@id` by the whole-token rule.

### Groups in a run

Spec 03's selection to request already expands a selected group in place (one slot at the box's top edge, members in their own order inside it, a member selected with its group counted once) and resolves `@group` to its prompt members' text without media. Every rule specs 03 to 05 apply to selected shapes applies to members the same way. Selecting only a member (clicking inside a box selects the child) treats it as a loose shape.

**Hint.** When the selection is exactly one group, the toolbar hint reads `@<name>` instead of "N selected" (spec 03's toolbar states). In the composer's sources band the group shows as one chip (the kit's Badge `outline`) reading `@<name>`, and its members keep their role badges on the canvas while the composer is open.

**Agent.** Agent on a selection containing a group sends every member as context, as spec 08 sends any selected shape.

### Recipe groups

**Schema.** A group's standing recipe is spec 03's `GroupRecipe` (medium, model, params, runs), stored on the group shape as `meta.unframed.recipe` and synced like any shape property. Unlike a result's recipe it holds no per-run instruction, no selection prompt and no references: its sources are always the group's members as they are when it runs. The keys in `params` are exactly the ones the Generate tray holds for that medium (specs 03, 04, 05 own them). The recipe holds no text: an instruction that should persist belongs in a prompt member. A recipe is applied through the same path the composer uses to reopen a result's recipe (spec 03), so a model that has left the catalogue or a parameter the model no longer declares is handled the same way there.

**Chip.** The label shows the chip after the name, in the same row, as the kit's outline Badge (spec 12), in normal case. Its text is built from the recipe, parts joined by ` · ` (space, middle dot, space), parts left out when the recipe does not set them:
- the model's name without its provider prefix (`openai/gpt-image-2` becomes `gpt-image-2`);
- image: the exact size when set, as `1024²` when width equals height and `1024×1536` otherwise; else the aspect ratio (`2:3`);
- video: the duration as `5s`, then the resolution (`720p`);
- text: nothing beyond the model;
- runs: `×N` when N is more than 1 (`×3`), `Free` for Free, nothing for 1.
Example: `gpt-image-2 · 1024² · ×3`. Clicking the chip opens the composer on the recipe.

**When a recipe applies.** When the selection contains exactly one recipe group, whatever else is selected. Other selected shapes join the run as sources in the usual order. With two or more recipe groups selected, no recipe applies and the composer opens on last-used values.

**Toolbar.** When a recipe applies, the selection toolbar shows, in order: the primary button (Button `default`), the hint, a "Recipe" button (Button `ghost`), and "Agent".
- The primary button reads "Generate" for one output and "Generate N×" for N, and while the run it started is going "Generating d / t…", where t is the run's output count and d how many have settled, counted from spec 03's `run.subscribe` events. Clicking it starts the run at once with the recipe's medium, model, params and runs, with the expanded selection as sources and no instruction. It does not open the composer.
- For a Free recipe, the primary button reads "Generate" and opens the final prompt dialog from spec 05 first; nothing is spent until that dialog's "Generate N×".
- The hint reads `@<name>` and, when spec 03 can estimate the run, ` · ` and the estimate (`~$0.57`).
- "Recipe" opens the composer on the recipe.
The run is an ordinary run: the same request, sidecars, batch and results as specs 03 to 05. Results land beside the box, outside it, by spec 03's placement rule. A recipe run does not change the composer's last-used values.

**Composer on a group.** When the selection is exactly one group, the composer shows a recipe line under the tray, in `text-xs`. Its buttons are the kit's InlineButton: a quiet button is the `muted` tone, a plain one the `default` tone. Its content depends on the state:
- group without a recipe: a quiet button "Save as recipe" (tooltip "Keep these settings on @<name>. Its Generate uses them.");
- recipe applies and the tray matches it (`recipeEquals`): the text "Recipe of @<name>" (muted) and a quiet button "Clear recipe";
- recipe applies and the tray differs: a button "Update recipe" and a quiet button "Clear recipe".
When a recipe applies, the composer opens with the tray set from the recipe instead of last-used values. Editing the tray never writes to the group; only "Save as recipe" and "Update recipe" do. Generate from the composer uses the tray as it stands.

**Context menu.** A recipe group gets "Clear recipe" in its Edit section.

**Undo.** Save, update and clear are user edits: one tldraw undo step each. A group losing its recipe keeps its members and name.

### The library

**Where presets live.** User presets live in `presets.json` at the root of the output folder, beside the project folders, because a preset belongs to the person and not to a project. System presets ship inside the app (built by the preset rules from the text in assets) and are never written to `presets.json`.

**Preset record** (one entry of the array):

```ts
type Preset = {
  format: 2;                    // entries without it are not this version's (see "Unknown entries")
  id: string;                   // "user-" + Date.now() in base 36; system presets use fixed ids
  source: "user" | "system";    // only "user" is ever stored
  savedAt: string;              // ISO time, set by the engine at save
  name: string;                 // trimmed, non-empty
  summary: string;              // trimmed, may be empty
  needs?: string;               // what to do after inserting it, shown on the card
  kind: "recipe" | "group";     // derived: does the group have a recipe
  medium?: "image" | "video" | "text"; // the recipe's medium, absent for "group"
  content: PresetContent;
};
```

`PresetContent` is tldraw content as tldraw's own copy produces it for the group and its descendants: the shape records, the asset records, the bindings among them and the tldraw schema they were written with, so tldraw's migrations apply on insert. It holds exactly one root shape, the group. Two adjustments are made at save time: every asset whose `src` is `project-file:<file>` is rewritten to spec 02's portable pointer `preset-file:<project>/<file>`, naming the project it was saved from, and every run marker, run error and unfilled result meta is removed (spec 03's copy rule). A saved preset carries no bytes.

**Saving ("Add to library").** Offered in the context menu's Library section and enabled when the selection (or the right-clicked shape, when nothing is selected) can become one group:
- exactly one group, with or without loose non-groupable shapes: the preset is that group, its members and its recipe;
- no group, at least one groupable shape: the preset is a new group wrapped around the groupable shapes by the wrap rule, whose `@id` is the slug of the preset name (a minted `@id` when the slug is empty);
- two or more groups, or a group plus loose groupable shapes: disabled, tooltip "A preset is one group. Select one group, or shapes outside any group.";
- nothing groupable: disabled.
Pages and motions in the selection are never saved. The content is captured when the menu item is clicked, so edits made while the dialog is open are not saved.

The "Add to library" dialog: title "Add to library", subtitle "N shape(s), saved as you have them now." ("1 shape" singular), or "N shape(s) and its recipe, saved as you have them now." when the group has a recipe, where N counts members. The kit's Dialog (spec 12), 420 wide. Fields, each a kit Input under its label: "Name" (autofocused, placeholder "e.g. Portrait retouch"), "Description" (placeholder "What it does, in a line"). Buttons in the kit's dialog footer: "Cancel" (Button `outline`) and "Save" (Button `default`). An empty name shows "Give it a name." under the field and saves nothing. A failed save shows "Could not save. Is the local server running?" under the name. Success closes the dialog and toasts "Saved “<name>” to your library." (typographic double quotes U+201C and U+201D around the name).

**The Library dialog.** Opened by the "Library" button in the canvas chrome (icon Library). The kit's Dialog (spec 12), 680 wide, title "Library". The search field is the kit's InputGroup, the sort the kit's Select, and each toggle the kit's `segmented` ToggleGroup. It re-reads the user presets every time it opens.

Row 1, left to right:
- search field, hidden label "Search presets", placeholder "Search presets…", search icon. Matches the trimmed, lowercased query as a substring of "<name> <summary>", lowercased;
- sort select, hidden label "Sort": "Newest" (default), "Oldest", "A–Z", "Z–A" (en dashes);
- view toggle, label "View", icon-only items "Cards" (grid icon) and "List" (list icon).
Row 2:
- type toggle, label "Type": "All", "Recipes", "Groups";
- source toggle, label "Source": "Any", "Custom", "System" ("Any", not a second "All").

The list is the user presets followed by the system presets, filtered by type, source and query, then sorted, then cut into pages of 10. Sorting is stable. "Newest" orders by a rank: `savedAt` when present, a rank above every system preset for a user preset without one, and the lowest rank for system presets. "Oldest" is its exact reverse. "A–Z" compares names with locale comparison; "Z–A" is its reverse. The page resets to 1 when the query, a filter or the sort changes, and is clamped to the last page (deleting the last preset on the last page never shows an empty page). Pagination appears only when there are more than 10 results, right-aligned, showing a count ("11–20 of 23") and the previous and next page buttons (Button `ghost` at an icon size).

Empty result: "Nothing here yet. Try another category or clear the search."

The view choice is stored in spec 01's preferences store under `library.view` as `card` or `list` (default `card`), so it survives the packaged app's new origin on every launch; when the preference cannot be read the dialog opens in card view. The sort is not remembered.

Card view: a grid of cards, each on `--card` with the kit's border and `rounded-xl` radius. Each card: the name (medium weight), the summary, the needs line when present (supporting ink), then a row of chips, then a footer strip under a divider holding "Add" (Button `outline` at `xs` size, as in list view). A user preset has a delete icon button in the top-right corner. List view: dense divided rows; the name and its chips on one line, the summary below clamped to three lines with the full text in a native tooltip, then "Add" and the delete button at the row's end.

Chips (label = the value capitalised, each with an icon and a hue; each is the kit's Badge `label`, tinted from `--label` set to the Tailwind palette colour of its hue at 500): type `Recipe` (Workflow icon, purple) or `Group` (Group icon, blue); medium `Image` (Image icon, teal), `Video` (SquarePlay icon, orange), `Text` (Type icon, cyan), shown only for recipes; source `Custom` (UserRound icon, green) for user presets or `System` (Package icon, pink).

Delete: an icon button (Button `ghost-destructive`) with accessible label "Delete <name>" and tooltip "Delete from your library", only on user presets. It opens an alert, the kit's AlertDialog: title "Delete preset?", body "This removes “<name>” from your library. Shapes already on the canvas are untouched. This can't be undone.", action "Delete preset" (Button `destructive`) beside "Cancel". A failed delete toasts "Could not delete that preset. Is the local server running?".

A failed read (for example a damaged file) keeps the system presets on screen and shows one line above the list, the kit's Alert `error`: "Your presets could not be read: <engine message>". Saving and deleting stay refused until the file reads again, because the engine refuses them (below).

**Inserting ("Add").** Closes the dialog and inserts the preset into the current page as one undo step:
1. tldraw inserts the content with fresh shape ids and applies its schema migrations.
2. `@id`s are re-minted: a prompt's `@id` always gets a fresh minted one; a group whose `@id` is a name keeps it, suffixed by the rename rule if any `@id` on the canvas already uses it; a group whose `@id` is a minted one gets a fresh one.
3. Every whole `@old` token in the inserted prompts' text that names a shape in the preset is rewritten to that shape's new `@id`. Tokens that name nothing in the preset are left exactly as typed.
4. The group's bounds are centred on the centre of the visible canvas. Members move with the box because their positions are relative to it.
5. Every `preset-file:<project>/<file>` pointer is resolved by the media copier into the current project (an empty `<project>`, spec 11's form for old presets, means the current project itself). A copied file replaces the pointer with spec 02's `project-file:<file>` marker before anything reaches the room, which refuses `preset-file:`. A missing file leaves that image or video shape empty (asking for a file), and one toast says "<n> file(s) in “<name>” are no longer on disk, so their shapes arrived empty."
6. The selection becomes the inserted group.
Inserted shapes have no link back to their preset.

### Engine RPC methods

All on spec 01's RPC socket, all serialised through one write queue per output folder in the engine.

- `library.list()` returns `{ presets: Preset[] }`: the entries of `presets.json` that have `format: 2`. Missing file: an empty list. Unreadable or damaged file: fails with the message `presets.json is not valid JSON.` (bad JSON) or the read error's message.
- `library.save({ name, summary, needs?, content })` returns `{ preset }`. Re-reads the file (same read rule, failing the same way), derives `kind` and `medium` from the content, mints `id` (if the id is taken, the millisecond is incremented until it is free) and `savedAt`, puts the new preset first, writes the whole array. Refuses an empty trimmed name with `Give it a name.` and content without exactly one root group with `A preset is one group.`.
- `library.delete({ id })` returns `{ ok: true }`. Re-reads, removes the entry with that id, writes the whole array. An id not in the file fails with `That preset is not in your library.`.
- `library.copyFiles({ project, files: [{ project, file }] })` returns one entry per file, `{ file }` (the new file's name in the target project) or `{ missing: true }`. Copies each file with a new name under spec 02's media naming rule and writes a sidecar `{ source: "copy", fileName, mime, bytes, at, of, ofProject }`. File names are basenames only; anything else is refused with `That is not a file in this project.`. An entry's `project` is the project named by a `preset-file:<project>/<file>` pointer; an empty one means the target project (spec 11's converted presets). Source and target may be the same project; the file is still copied, so deleting either shape never affects the other.

### The write rule for `presets.json`

- **The read** returns an empty array only when the file does not exist. Any other read failure fails, and invalid JSON fails with `presets.json is not valid JSON.`. Treating "unreadable" as "empty" is what would let the next save erase the file.
- **Every write replaces the whole array** and every write re-reads the file immediately before, inside the write queue. The engine never writes from a cached copy.
- **Writes are temp-then-rename**, so a crash mid-write leaves the old file.
- **Unknown entries** (entries without `format: 2`, which includes every preset the old app saved) are kept exactly as they are, in place, on every save and delete, and are not listed. Spec 11 reads them.
- **Why a single instance.** Because every write replaces the whole array from one read, two engines on the same output folder would each erase the other's saves. The desktop shell holds a single-instance lock for this reason. The engine does not lock the file; one engine per output folder is the supported setup, and this spec does not change it.
- Not browser storage: one saved picture would exhaust a `localStorage` quota, and the library must be shared by every project and tab.

### System presets

Both are recipe groups, built at startup by the preset rules. Their prompt text comes from assets, verbatim.

**Layerize** (`id: "layerize"`). Name "Layerize". Summary "Split an image into its parts as separate generations". Needs "Drop your picture into the image, then Generate to write the plan. Then select the plan with your picture, set Runs to Free and Generate." A group `@layerize`, 420 wide, with a recipe `{ medium: "text", model: <the app's default text model at insert time>, params: {}, runs: 1 }`. Members, top to bottom: a prompt holding the text in `assets/prompts/preset-layerize-plan.md`, then an empty image shape. The first Generate writes the plan as a text result beside the box; the second run (Free, image) makes one generation per section, each with the picture as image 1. The planner's text leads with "plain prose only" and bans coordinates on purpose: asked bare, some vision models answer with bounding boxes instead of sections; and each section starts "From image 1, recreate" because a section written as a fresh scene description made the image model treat the picture as loose inspiration. Keep the text verbatim.

**Prose to JSON** (`id: "to-json"`). Name "Prose to JSON". Summary "Turn a written prompt into a structured JSON spec you can reuse". Needs "Select your prompt together with this box, then Generate." A group `@to-json` with a recipe `{ medium: "text", model: <default text model>, params: {}, runs: 1 }` and one prompt member holding the text in `assets/prompts/preset-prose-to-json.md`. Its answer lands as a text result with its own `@id`, which other prompts can reference.

"The app's default text model" means the model spec 10's settings hold when the preset is inserted, so the system presets never pin a slug that may disappear.

## Testing Decisions

A good test drives one interface and asserts on what comes out of it: the returned plan, the records the engine holds, the file on disk, what is on screen. No test reaches into a module's internals or asserts on tldraw's private state.

- **Domain seam** (Vitest, direct calls) carries the rules with many cases: the slug rule, the suffix loop, the whole-token rename rewrite (`@fox` vs `@fox-2`, `@foxes`, several tokens in one text, text results untouched), the recipe chip for every medium and runs value, `recipeEquals`, preset derivation (kind, medium, the four selection cases), instantiate (fresh ids, name kept, name suffixed, minted re-minted, internal tokens rewritten, external tokens left), placement arithmetic, and the library view (filter by each axis, each sort including undated user presets, page cut after sort, clamp, reset).
- **Engine seam** (forked engine in a temp output folder) carries the preset store and the copier: missing file lists empty, bad JSON fails with the message and a following save fails and leaves the file byte-identical, save prepends and replaces the whole array, a save re-reads (write the file behind the engine's back between two saves; both entries survive), unknown entries survive a save and a delete byte-for-byte, delete of an unknown id fails, two concurrent saves both land, copy writes the file and sidecar, a missing file answers `missing`, a path with a slash is refused.
- **Browser seam** (Playwright against a stubbed engine) carries every gesture this spec adds (spec 02 already covers wrap, ungroup, membership and delete): rename by double-click and F2, Escape, Backspace in the field, a collision suffix, a rename rewriting two prompts and undone in one Cmd-Z, the toolbar hint, a run on a group (assert the stub received members in the expected order), a recipe saved, shown as a chip, run from the toolbar (assert the stub received the recipe's model and params), a Free recipe stopping at the final prompt, Recipe opening the composer, Update and Clear, the Library dialog's controls, the view remembered across reloads, Add placing and selecting the group, a preset with a missing file, delete with confirmation.

Prior art: the old app pinned exactly these rules (wrap, rename rewrite, fragment instantiation, the preset read rule) as small assert-based checks over pure functions and one forked-server test. Keep that shape: most cases at the domain seam, a handful of engine and browser tests that prove the wiring.

## Tasks

1. `slugName` applies spec 01's slug rule; `uniqueName` suffixes `-2`, `-3` against every `@id`. Seam: domain.
2. `renamePlan` rewrites whole `@old` tokens in prompts only, skipping text results. Seam: domain.
3. Rename field: double-click label or F2 opens it with `@` and the name selected; Enter and blur commit; Escape abandons; Backspace edits text. Seam: browser.
4. Rename commits the slug, the suffix and all prompt rewrites as one undo step. Seam: browser.
5. Pasting a named group keeps or suffixes its name and rewrites references among the pasted shapes. Seam: browser.
6. A run on a selected group sends its members in that order with spec 03's numbering; badges show on members while the composer is open. Seam: browser.
7. Toolbar hint reads `@<name>` for one selected group; the composer's sources band shows one `@<name>` chip. Seam: browser.
8. The `@` mention menu and "Copy @id" include groups. Seam: browser.
9. `recipeFromTray` and `trayFromRecipe` round-trip spec 03's `GroupRecipe` for every medium, and never carry an instruction. Seam: domain.
10. `recipeChip` formats model, size or ratio, duration and resolution, runs (`×N`, `Free`). Seam: domain.
11. "Save as recipe" in the composer stores the tray on the group as one undo step and the chip appears. Seam: browser.
12. Composer opens with the tray set from the recipe when one recipe group is selected; with two, last-used values. Seam: browser.
13. Composer recipe line shows "Recipe of @name" when matching and "Update recipe" when the tray differs; editing the tray alone never changes the group. Seam: browser.
14. "Update recipe" writes the tray; "Clear recipe" in the composer and context menu removes it; each one undo step. Seam: browser.
15. Toolbar on a recipe group shows "Generate N×", hint with estimate, "Recipe", "Agent". Seam: browser.
16. Toolbar Generate runs at once with the recipe (stub receives the recipe's model and params and N requests sharing a batch id), with no instruction, results beside the box. Seam: browser.
17. A Free recipe's Generate opens the final prompt dialog and spends nothing until confirmed. Seam: browser.
18. Recipe applies with loose shapes also selected; they join the sources in order. Seam: browser.
19. A recipe run leaves the composer's last-used values unchanged. Seam: browser.
20. Chip click and "Recipe" open the composer on the recipe. Seam: browser.
21. Preset store read rule: missing file lists empty; bad JSON fails with `presets.json is not valid JSON.`. Seam: engine.
22. `library.save` re-reads, prepends, writes the whole array temp-then-rename, mints id and `savedAt`, refuses an empty name and a non-group content. Seam: engine.
23. A save over a damaged file fails and leaves the file byte-identical. Seam: engine.
24. Unknown entries survive save and delete unchanged and are not listed. Seam: engine.
25. `library.delete` removes by id and refuses an unknown id; concurrent saves both land. Seam: engine.
26. `library.copyFiles` copies with a sidecar naming `of` and `ofProject`, answers `missing`, refuses non-basenames. Seam: engine.
27. `presetFromSelection` covers the four selection cases, derives kind and medium, strips run markers, rewrites `project-file:` sources to `preset-file:<project>/<file>`. Seam: domain.
28. "Add to library" menu entry enabled, disabled with the tooltip, or hidden per selection; captures content at click. Seam: browser.
29. Save dialog: subtitle counts and mentions the recipe; empty name error; failure message; success toast. Seam: browser.
30. `libraryView` filters by type, source and query, sorts by each option with the undated-user rank, cuts pages of 10 after sorting, clamps and resets. Seam: domain.
31. Library dialog renders both rows of controls, the empty message, pagination only past 10. Seam: browser.
32. View toggle persists in the `library.view` preference across reloads and an engine restart on a new port, and the dialog opens in card view when the preference cannot be read. Seam: browser.
33. Cards and list rows show name, summary, needs, chips, Add, and delete only on user presets. Seam: browser.
34. Delete asks with the alert copy, removes the preset, and toasts on failure. Seam: browser.
35. The dialog re-reads on every open and shows the read-failure line when the file is damaged. Seam: browser.
36. `instantiate` mints fresh ids, keeps or suffixes group names, re-mints minted ones, rewrites internal tokens and leaves external ones. Seam: domain.
37. Add inserts centred on the view as one undo step, selects the group, closes the dialog. Seam: browser.
38. Add copies files into the current project; a missing file leaves an empty shape and one toast. Seam: browser.
39. System presets Layerize and Prose to JSON are listed with the System chip, built from the asset text, and insert as recipe groups using the current default text model. Seam: browser.

## Out of Scope

- Nested groups, and pages or motions inside a group.
- A dedicated character, product or template shape type: those are names people give saved groups.
- Injected prompt text of any kind when a group is mentioned or run.
- A recipe that holds an instruction or a list of sources other than the box's members.
- Presets that carry bytes (inlined pictures or clips), sharing presets between machines or people, and any online library.
- Versioned presets, "update all instances", and any link from an inserted preset back to its preset.
- Per-preset HTTP routes; the library is reached only through the RPC methods above.
- Reading presets saved by the old app (spec 11).
- The agent's view of groups and recipes (spec 07 reports them through its canvas tools).

## Further Notes

- Why a container and not a character shape: a second way to hold a picture would give every path that touches media (size caps, the file pointer, crop, sketches, copy) two shapes to handle forever. A group of ordinary image shapes has one.
- Why media never follows a mention: a token that attached pictures would spend money on references the person never selected. What a run sends is what the selection shows.
- Why a recipe holds no text: text in a recipe would be invisible prompt text added to every run. Text that should persist is a prompt member, visible on the canvas.
- Why the one-click toolbar run is safe: it is the same one click the old output node's Generate button was, and the button states how many outputs it makes; Free keeps its confirm step.
- A saved preset stores portable file pointers rather than bytes, so a preset whose source project is deleted or renamed arrives with empty media shapes and says so. Carrying bytes in a preset is out of scope; this is the known cost.

### Assets this spec needs

- `assets/prompts/preset-layerize-plan.md`: the Layerize planner prompt text. Old source: `client/src/library/layerize.js`, the `plan` node's `data.text`.
- `assets/prompts/preset-prose-to-json.md`: the Prose to JSON instructions, with its three blank-line paragraph breaks. Old source: `client/src/library/toJson.js`, the `convert` node's `data.text`.
- `assets/theme/`: the chip hues (purple, blue, teal, orange, cyan, green, pink) and the group border and label colours, if not already ported. Old source: Astryx Token colours used by `client/src/library/LibraryDialog.jsx`, and the `.xnode-group` rules in `client/src/styles.css`.
