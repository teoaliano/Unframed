# 16 · Nodes: wires and output nodes

Depends on: 01 to 15 (read 00-index first).

## Problem Statement

People repeat the same multi-step job. They make an image, then turn that image into the first frame of a video. Or they run one prompt again and again, changing only an input or a setting. Today the only way is to select the inputs, reopen the composer and set everything again, every time. The chain lives in their head, and nothing on the canvas shows what depends on what, what is stale, or what a whole chain will cost.

The old app had output nodes and wires. The rewrite removed them (spec 02, Out of Scope) because its node graph had to reinvent every drawing interaction and kept its own sync layer. What it got right, and the rewrite lacks, is the persistent card: a place on the board where a setup stays put, takes new inputs, and runs again. Issue #103 asks for that card back, and for wires between shapes. It asks for it on top of what exists, not in place of it. Selection-based Generate, the composer popover, groups, recipe groups and the library stay as they are.

## Solution

A **node** is a persistent composer on the canvas. It has the same tray as the Generate composer (medium, model, settings, runs) and an instruction box that keeps its text. Its results stay inside it as **versions**, the newest shown, the older ones kept. Each version is also an ordinary file with its usual sidecar, and it can be dragged out as an ordinary shape.

Shapes are **wired** into a node: a prompt, an image, a video, a page, a motion, a group, a mark, or another node's current result. Each wire carries a **role** that says what its source does in the node's run. A video node shows "first", "last", "reference" or "prompt" on each incoming wire, and the role replaces top-to-bottom order for wired inputs. Wired inputs are additional to selection: selecting shapes for Generate works exactly as before.

Running:

- Each node has its own **Run**. **Run downstream** runs it and then every node that depends on it.
- Select several nodes, or a group that holds them, and **Run chain** runs them in dependency order, one step after another.
- A node whose inputs changed since its current result was made is flagged **out of date**. Nothing runs by itself.
- A failed step stops the chain. The steps after it show why, and none of them runs or spends money.

Chaining works because a node's current result is an input to the nodes wired from it: an image node's result can be wired into a video node as its first frame.

A node can also write a **page**. Its medium is `page`: a text model writes one HTML document, which lands as a page version that the node previews and that can be dragged out as a page shape (spec 09). A page can feed a node as its HTML source, as a captured picture of it, or as both, chosen on the wire.

Agents read and write nodes and wires through the canvas tools (spec 07), and start runs with `node_run`, which in-app and outside agents both have (spec 14). Their paid steps follow the same rules as `generate`, including the outside spend limit.

What this spec does not change: Generate on a selection, the composer popover and its Agent tray, groups and their recipes, the library's existing presets, and every run's file, sidecar and recipe format. A node contributes nothing to a selection-based run, as a page does.

## User Stories

1. As a person, I want to add a node to the board from the add menu, so that I have a persistent place for a repeatable job.
2. As a person, I want a node to show the same tray as the Generate composer (medium, model, settings, runs), so that I set it up the way I already know.
3. As a person, I want a node to keep its instruction text between runs, so that I change one input and run again without retyping.
4. As a person, I want to draw a wire from a prompt, image, video, page, motion, group, mark or node into a node, so that the node takes that shape as an input.
5. As a person, I want a wire into a node that is not a node refused with a sentence that tells me where wires go, so that I know what to connect to.
6. As a person, I want a wire that would loop back into the node feeding it refused, so that a chain always ends.
7. As a person, I want each wire to show its role on the canvas, so that I can read off what each input will do before I run.
8. As a person, I want to change a wire's role from a small menu, so that one picture can be a first frame or a reference.
9. As a person, I want a video node's first and last frame roles offered only when the model takes frames, so that I never set a frame that does nothing.
10. As a person, I want a second first-frame wire refused until I change the first, so that a frame is never filled twice.
11. As a person, I want the references of a node numbered in the order they appear in its input list, so that "image 2" in my instruction means what I expect.
12. As a person, I want to drag a reference up or down in the node's input list to renumber it, so that I can fix the order without rewiring.
13. As a person, I want a prompt wired in to contribute its text, joined with the other text in the same way as a selection, so that prompts compose the same everywhere.
14. As a person, I want a page wired in to contribute its HTML source as text, so that a code prototype can be the input to a run.
15. As a person, I want a motion wired in to contribute its newest render as a reference video, so that a motion I ship can feed a video node.
16. As a person, I want a node to say "Render this motion first" when the motion has no render, so that I know why it waits.
17. As a person, I want a group wired in to contribute its members in their order, so that a set I keep can feed a node in one wire.
18. As a person, I want a wire from an image that carries a mark to bring the mark along as a sketch, so that a drawn note reaches the run.
19. As a person, I want a node wired from another node to take that node's current result, so that chains work.
20. As a person, I want a node to show "Waiting for @name" when its input node has no result yet, so that I know what to run first.
21. As a person, I want Run to be disabled while the node is running and to say so, so that I never start the same run twice.
22. As a person, I want each node result to land inside the node as the current version, so that the node always shows what it last made.
23. As a person, I want earlier results kept as versions in a strip on the node, so that I can go back to one.
24. As a person, I want to choose which version is current, so that a downstream node uses the take I picked.
25. As a person, I want to remove a version from the node without losing its file, so that the node stays tidy and the folder stays complete.
26. As a person, I want to drag a result out of a node onto the board as an ordinary image, video or prompt shape, so that I can use it anywhere a shape goes.
27. As a person, I want a dragged-out result to be an ordinary result with its recipe, so that Regenerate works on it as on any result.
28. As a person, I want Run to run only that node, and Run downstream to run it and the nodes after it, either all of them or only those that failed, are waiting, are out of date or never ran, so that I choose how much I spend.
29. As a person, I want a node that is out of date flagged with the reason ("an input changed since this ran"), so that I know it no longer matches its inputs.
30. As a person, I want nothing to run on its own when an input changes, so that no money is spent without my action.
31. As a person, I want a node that has never run to say "Not run yet", so that a fresh node is not mistaken for a stale one.
32. As a person, I want a failed run to show its reason on the node until I run it again, so that I can fix the cause.
33. As a person, I want to select several wired nodes and run them as a chain, so that a whole setup runs at once.
34. As a person, I want to select a group that holds nodes and run them as a chain, so that a group is a chain I can keep.
35. As a person, I want the chain to run in dependency order, so that every node gets its input made first.
36. As a person, I want the chain button to say how many nodes and, when every step has an exact price, what the chain will cost, so that I see the spend before I make it.
37. As a person, I want a failed step to stop the chain: the steps after it show why, and none of them runs or spends, so that a failure never costs me more.
38. As a person, I want a node with no result upstream to stop the chain before any step runs, so that a chain never fails halfway for something I could have seen.
39. As a person, I want a chain to keep running when I close the tab, so that a long video chain finishes and lands.
40. As a person, I want a video step in a chain to wait for its render before the next step starts, so that the next node gets the finished clip.
41. As a person, I want the Generate button on a selection to stay as it is when the selection holds nodes, so that selection-based runs keep working.
42. As a person, I want a selection holding only nodes to offer Run chain and Agent, so that I am never offered a Generate that would make nothing.
43. As a person, I want a node to take no part in a selection's Generate, so that a node's result is never sent twice by accident.
44. As a person, I want to put a node into a group, so that a group can hold a chain.
45. As a person, I want to delete a wire by selecting it and pressing Delete, so that I can rewire without a menu.
46. As a person, I want deleting a node to remove its wires and leave its files in the folder, so that a delete never takes results with it.
47. As a person, I want Undo to revert my edits to a node and its wires, but never to remove a result the node already made, so that paid output is never lost to Cmd-Z.
48. As a person, I want to save a set of nodes and the wires between them to the library, so that I can reuse a flow in another project.
49. As a person, I want a saved flow to come back with its nodes and wires but no results and no inputs, so that I can fill it with new inputs and run it.
50. As a person, I want a wire from outside the saved set left out when I save, with a count of the wires that were left out, so that I know what did not come with the flow.
51. As a person, I want a node's settings to come from the model catalogue as the composer's tray does, so that a node offers only what the model takes.
52. As a person, I want a node's last-used values to start a new node, so that a second node needs no setup.
53. As an agent, I want `canvas_read` to report nodes with their settings, status, current result and versions, and wires with their roles, so that I can see a workflow the way the person does.
54. As an agent, I want `canvas_write` to create and edit nodes and wires, so that I can build a workflow for the person.
55. As an agent, I want `node_run` to run one node, or a chain, with a dry run that shows each step's prompt, inputs and estimate, so that I can show the person the cost before I spend it.
56. As an outside agent, I want `node_run` to respect the connection's spend limit for every step, so that a chain cannot pass a limit one step at a time.
57. As a person watching an agent's turn, I want a node the agent made or ran to be a change of that turn, so that Revert this turn removes the node and the wires the turn made.
58. As a test author, I want every node run to go through the same engine seams as Generate, so that the stubs and the fixtures serve both.
59. As a person, I want a node to write a page from its prompt, so that a code prototype can be made and remade on the board.
60. As a person, I want a page a node writes to preview inside the node and to drag out as a page shape, so that it behaves like a page I made.
61. As a person, I want to choose what a page sends to a node (its HTML, a picture of it, or both), so that the input suits the model I picked.
62. As a person, I want a page that links other project files to send either the page alone or the linked files too, so that a multi-file prototype works.
63. As a person, I want a run refused, with a reason, when the picture cannot be taken because Chrome is missing, so that a run never quietly sends less than I chose.

## Implementation Decisions

### Terms this spec adds

- **node** (shape kind): a persistent composer card on the canvas.
- **wire** (shape kind): a dedicated connection shape with two ends that name their shapes, from one shape to one node input, carrying a role. Its look is a known gap until the person's reference image arrives (Further notes); this spec fixes its behaviour.
- **role** (of a wire): what the source does in the node's run. One of `prompt`, `reference`, `first`, `last`.
- **version**: one result of a node run, kept on the node.
- **current version**: the version a node shows and its wires carry downstream.
- **input fingerprint**: a hash of everything a run sends: the medium, model, params, instruction, and for each wire in order its role, its source and the source's content now.
- **out of date**: a node whose current version was made from a fingerprint that differs from its inputs now.
- **chain**: an ordered set of nodes run one after another. A chain of one is a single Run.

### Modules

| Module | Package | Interface | New or extended |
| --- | --- | --- | --- |
| Wire rules | domain | `wireRefusal(wires, source, target, role)` returns a refusal sentence or null (not a node, a loop, a repeated frame role, audio, a role the medium does not take, a group or clip in a frame role); `rolesFor(medium, model, sourceKind)` returns the roles offered | new |
| Node request | domain | `nodeRequest({ node, wires, canvas, props })` returns the same request fields spec 03, 04 or 05 build for the medium, with the wired shapes as the input set, and the roles | new; the roles and the request come from one function so they cannot disagree |
| Input fingerprint | domain | `inputFingerprint(node, wires, canvas)` returns a stable hash | new |
| Node status | domain | `nodeStatus(node, wires, canvas)` returns one of `not_run`, `running`, `failed`, `waiting`, `out_of_date`, `ready`, with the blocker's name | new |
| Chain planner | domain | `planChain(nodes, wires, canvas)` expands groups to their nodes, orders by dependency with canvas order as the tie-break, refuses loops, and names every upstream input that has no result | new |
| Flow rules | domain | `flowFrom(selection)` keeps the nodes, their wires and the shapes saved with them, and counts the dropped wires; `flowInsert(flow, ids)` gives fresh ids and rewires | new, beside spec 06's preset rules |
| Canvas tool service | engine | `canvas_read` and `canvas_write` accept the node and wire kinds | extended (spec 07) |
| Node run service | engine | `node.run` and `chain.run`: validation, versions, the chain runner, the boot resolution of versions | new, built from specs 03, 04 and 05's run services |
| Node shape and wire shape | contracts | the `node` and `wire` props and meta, with their first migration | new |
| Node shape util, wire shape util, node composer | web | the card, the connector, the tray reused from spec 03 | new |
| Page answer | domain | `pageAnswer(text)` returns the HTML document or a refusal sentence; `pageTitle(html)` returns the document's title | new |
| Page inputs | domain | `pageSend({ wire, model })` returns what a page wire sends (HTML, picture or both, entry or linked files) from the wire's choice or the model's default in `pageSendDefaults`; `linkedFiles(html, projectFiles)` returns the project files a page links, with the caps | new |
| Page capture | engine | `captureFor(pageFile, files)` returns the capture to send, reusing a capture whose page hash matches, else taking one with spec 09's Chrome finder | new |
| Run chain button | web | the selection toolbar's chain state | extended (spec 03) |

### The node

- **Schema.** A custom shape like page and motion (spec 02): `meta.ref` (minted or named, spec 06); `props: { w, h, medium, model, params, runs?, instruction, versions, currentVersionId, run?, error? }`. `medium` is one of the media the composer registers, or `page` (a text model whose answer is a page, see Page output). `params` are the keys the tray holds for that medium (specs 03 to 05). `runs` is 1 to 10 for image, absent otherwise. `versions` is newest first. `run` is set while a run is going: `{ runId, chainId, startedAt }`.
- **Size.** Default 380 by 360. Width 320 to 640, height at least 240. The card scrolls inside when its content is taller.
- **Label.** Spec 02's label rule: `@<name>` once named, else `Node`, above the top-left.
- **Creation.** From the add menu's Inputs section (spec 02). A new node starts on image, with the last-used values for that medium (spec 03) and the default model (spec 10), and then keeps its own values.
- **Groupable.** A node may be a member of a group (spec 02's member rule, changed by this spec).
- **Live or summary (contract 9).** A node shows its label, status line, medium and model chips and its current result as a picture, text or the video's still. Its editor (the tray, the instruction box and the input list) mounts only while the node is selected or being edited. A node that is not live costs the canvas thread nothing, as spec 09's artifacts do.
- **Node composer.** It reuses spec 03's tray components: the medium switch, the instruction editor with its `@` menu, the model chip and dialog, the prop chips, `+ add prop`, the price estimate and the send button. It differs in three ways. Its inputs are its wires, not a source band. Its instruction persists on the node. Cmd+Enter runs the node.
- **Settings.** They come from the model catalogue as the tray does now, with the defaults spec 03 hand-picks (research note, question 5: catalogue, as proposed). Dropdowns and toggles are the dials. Nodes take no DialKit control.
- **Free.** Free mode (spec 05) is not a node medium in this version. It needs a list from a selection, and the node's inputs are wires.
- **Recipe groups.** A node is not a recipe group. Spec 06's recipe rules do not change.

### Wires

- **Connecting.** A drag from a shape's wire handle (a dot on its right edge, shown while the shape is hovered or selected) onto a node. A wire dropped on anything that is not a node is refused. A refusal shows one toast sentence from `wireRefusal`, and no wire is created.
- **Refusals**, with their exact sentences:
  - Target not a node: `A wire ends at a node. Drop it on a node.`
  - Source is audio: `An audio shape is never an input yet, so this wire is refused.`
  - Loop: `That wire would loop back into @<name>. A node cannot feed itself through other nodes.`
  - Second frame role: `@<name> already has a <role> wire. Change that wire first.`
  - Role not taken by the medium: `<Medium> nodes take no <role>.`
  - Group in a frame role: `A group cannot fill a frame. Wire one picture instead.` (The role menu never offers it, so this is the refusal for a wire built by an agent.)
- **Roles offered.** By the node's medium and the source. A clip is offered `reference` only (spec 04: clips take no frame), and a group is offered `prompt` and `reference` only. By medium: image, `prompt` and `reference`; text and page, `prompt` and `reference`; video, `prompt`, `reference`, `first` and `last`; audio, `prompt` only. On a page wire the roles are HTML (`prompt`), Picture (`reference`) and Both (`both`), and nothing else (Page inputs). On a video node, `first` and `last` are offered only when the model declares frame images (spec 04's `supported_frame_images`). A wire kept in a frame role that the model no longer takes gets the unused mark (spec 04) and one warning line, and is not sent.
- **Role by source.** The source decides what a role sends:

| Source | `prompt` | `reference` | `first`, `last` |
| --- | --- | --- | --- |
| prompt | its text, resolved as spec 03 resolves it | not offered | not offered |
| image | not offered | the picture, numbered `image N` | the picture (video nodes) |
| video (a clip) | not offered | the clip as a video reference, numbered `video N` | not offered (spec 04: clips take no frame) |
| page | its HTML, read from its file at the request, when the wire sends HTML or both | its captured picture, when the wire sends a picture or both (Page inputs) | not offered |
| motion | not offered | its newest render: the MP4 whose sidecar's `of` is the motion's file; none means waiting | not offered |
| group | the text of its prompt members, in order | each media member in its order, as spec 03 numbers them | not offered |
| mark | not offered | a loose sketch, as spec 03 draws a loose mark. A mark on a wired image is composited onto it as spec 03 does | not offered |
| node | its current version when text or a page | its current version when an image or video | the current version when an image (video nodes) |

- **Order.** Reference wires are numbered in the order of the node's input list. The list shows the wires top to bottom; new wires go to the bottom; a drag changes the order. The role replaces top-to-bottom order for wired inputs. Selection's order (spec 03) is unchanged.
- **Persisting.** Wires are shapes, synced like any other. Moving a source keeps its wire attached. Deleting a source deletes its wires, as tldraw deletes bindings. Deleting a wire or a node is one undo step.
- **Drawing.** A wire is drawn as a curve in the kit's border colour, with its role as a small chip at its midpoint (spec 12's badge style). The chip shows the role, and for references the number (`image 2`). A click on the chip opens the role menu. The look of the connection shape waits on the person's reference image (Further notes); until then the curve, colour and chip above are provisional.

### The node request

`nodeRequest` composes the run the way spec 03, 04 or 05 composes a selection, with these inputs and no others:

- The prompt text is the text of the `prompt` wires, expanded and resolved as spec 03 resolves a selection's text, in wire order, joined with a blank line.
- The media are the `reference` wires in input-list order, with their kinds and numbering as spec 03 and 04 number them. The `first` and `last` wires are the frames.
- The instruction is the node's instruction, resolved as spec 03 resolves an instruction. A picture a prompt or the instruction names with `@` is attached after the wired references, as spec 03 attaches a named picture.
- The sources are the ids of every wired shape, with a group's members expanded, so the recipe records what fed the run. Shapes selected with the node do not join the run (decided).
- Validation is spec 03's, 04's and 05's, with the node's own messages below.

A domain test asserts that every wire's role appears in the request where the role table says it does, and that a role the model does not take appears in neither array.

### Versions

- **Record.** `{ id, runId, chainId?, batchId, runIndex, status: "running" | "done", file?, fileName?, text?, sidecar?, fingerprint, createdAt, error? }`. A `running` version is the placeholder of spec 03's lifecycle, on a node instead of on the canvas: it is written before the run's call answers, filled in one engine change when the work lands, and removed if the work fails. A durable render (spec 04) that fails keeps its version with `error`, as spec 04 keeps a durable placeholder with its run error.
- **Current.** When a run lands, the successful output with the lowest `runIndex` in that batch becomes current. A chain step is a run, so its landing sets current the same way.
- **Choosing.** "Use this version" on a version sets current. It is one undo step.
- **Removing.** "Remove version" takes its record out of `versions`. Its file stays on disk. If it was current, the newest remaining version becomes current, or none does.
- **Undo.** Undo reverts the person's edits to the node's props and wires. It never removes a version that landed, because the file and the charge are already made. Engine writes to `versions` and `run` carry origin `run:<runId>`, outside the person's undo history.
- **Dragging out.** A version is dragged onto the board. An image or video version creates an image or video shape that names the same project file, gets a minted `@id`, and carries its sidecar as its result meta, so it is an ordinary result with its recipe. A text version creates a prompt shape with its text, as spec 05 does for a text result. The node is unchanged.
- **Files.** Every file is named and written as spec 03, 04 or 05 names and writes it. Its sidecar gains `node: { shapeId, versionId }` and, for a chain step, `chain: { chainId, step }`. Both are additive. A paid sidecar still carries its cost (contract 4).

### Page output

- **Medium.** `page` is a node medium. It runs a text model, with the text medium's catalogue, tray and roles. Its instruction and wired inputs compose as a text node's do (spec 05).
- **Answer.** `pageAnswer` returns the answer when it holds one HTML document (an `<html` element or a doctype), with a Markdown code fence stripped. Otherwise the run fails with `The model did not return an HTML page. The call was made and may have been charged. Run again to retry.` The raw answer is written as `<stamp>-page-rejected.txt` in the project folder, with a sidecar holding the cost (contract 4), so a paid answer is kept and its name is in the message.
- **File.** A page answer is written as `<stamp>-page-<slug>.html` in the project folder, exclusively, with spec 03's retry names, through spec 09's page writer (the same new-file rule `page_write` uses). Its sidecar is `{ kind: "page", source: "node", title, prompt, model, cost, recipe, node: {shapeId, versionId}, chain?, batchId, runIndex, runCount, createdAt, file }`.
- **Version.** The page file is the version's `file`. Status and current-version rules are unchanged.
- **Preview.** The node shows the version as a snapshot (spec 09's snapshot rule, in `.cache/snapshots/`), not a live frame. When the node is selected, spec 09's live rules apply.
- **Drag out.** A page version dragged onto the board creates a page shape naming the file, titled with `pageTitle` (the document's `<title>`, else the node's name, else `Page`), at spec 09's default size, with a minted `@id`. The node is unchanged.
- **As an input.** A page version is an input like any page, with the same choices (Page inputs).
- **What this adds to spec 09.** A second writer of page files, the node run, through the same new-file rule and sidecar. A snapshot for node versions. Nothing in `page_write`, the dials or the live rules changes.

### Status

`nodeStatus` answers the first matching state, in this order:

1. `running`: the node carries a run marker. Status line: `Running…`, or `Rendering… (N min)` for a video (spec 04's wording).
2. `failed`: the node's last run failed and the node has not run or been edited since. The status line is `Failed: <message>`, with the message from the run.
3. `waiting`: an input has no result yet (`Waiting for @<name>, which has no result yet.`), an upstream node failed in this chain (`Waiting for @<name>, which failed.`), or a motion has no render (`Render @<name> first. A motion is an input once it has a render.`).
4. `not_run`: no current version. `Not run yet.`
5. `out_of_date`: the current version's fingerprint differs from `inputFingerprint` now. `Out of date. An input changed since this ran.` The node shows a small dot in the status colour.
6. `ready`: the current version matches. No line is shown.

Status never runs anything. A node's `failed` state persists across tab reloads because it is a prop, and it clears when the node runs again.

### Running one node

- **Own inputs only.** A node's Run uses only the shapes wired into it. Shapes selected with it do not join its run (decided). Running several nodes together is a chain, from a selection or a group.
- **Run** is spec 03's send, for the node's medium. It validates first, and a refusal writes no version and makes no call. The node's messages:
  - No input prompt and no instruction: `Prompt is empty. Wire a prompt, or type an instruction.`
  - An input that has no result: `<@name> has no result yet. Run it first, or use Run downstream from it.`
  - A motion with no render: `Render <@name> first. A motion is an input once it has a render.`
  - More references than the model takes: `<@name> has <n> references, and <model> takes at most <max>. Remove a wire, or pick another model.`
  - A frame role the model does not take: `<model> takes no <role> frame. Change that wire's role.`
  - Every other message is spec 03's, 04's or 05's, unchanged, including the missing key and the upstream failures.
- **One run at a time.** Run is disabled while the node carries a run marker, and reads `Running…`.
- **No upstream runs.** Run never runs an input node by itself. It uses each input's current version.
- **Outputs.** `runs` outputs make one batch, each a version; the lowest-`runIndex` successful one becomes current (above). The batch's failures are reported as spec 03's run report toast.
- **Run downstream** is the same as a chain (below) of this node and the nodes after it.

### Chains

- **What a chain is.** `planChain` takes the selected shapes. Every selected node is in the chain. Every node that is a member of a selected group is in it too. Nothing else is added.
- **Order.** A node runs after every chain node it takes input from. Ties go by canvas order: top edge, then left edge, then z. Steps run one after another; two steps never run at once, so a chain's spend is always in step order.
- **Inputs from outside the chain.** An input from a node that is not in the chain uses that node's current version, and the node must have one. Otherwise the chain is refused before any step runs.
- **Pre-validation.** Every step is validated before the first call. A refusal in any step writes nothing and names the step: `Step <n> (<@name>): <message>`.
- **Confirmation.** A chain with two or more paid steps asks once before its first step, in a dialog that lists each step's node, model and estimate, with Run and Cancel. A single Run keeps its single click (decided).
- **Spend.** The chain button's price is the sum of the steps' estimates when every paid step has an exact estimate (spec 03), else the sum with the missing steps named. The chain's spend is counted against an outside connection's limit before the first step (spec 14, Spend limit).
- **Step.** A step is a run of its node, as above. A video step's render is durable (spec 04): the chain waits for its version to be filled by the render's landing before the next step starts.
- **Failure.** When a step fails, its node shows its failure. The chain stops. Every node after it in the chain shows `Waiting for @<name>, which failed.` and never runs. Nothing else in the chain calls or spends. Versions that landed before the failure stay.
- **Success.** When the last step lands, the chain ends. Each node has its new current version. The tab shows the run report toast, `Chain: <n> of <m> nodes ran. <errors joined with "; ">`, warning when some ran and error when none did, and no toast when all ran.
- **Restart.** A chain does not survive an engine restart. Steps not yet started are not run, and their nodes show `Stopped: the engine restarted before this step ran.` A durable video render already started keeps running, and its version fills by the sweep (spec 04).
- **Tab closed.** A chain runs in the engine, not in the tab, as a run does (spec 03).
- **Last-used values.** A chain never changes any node's values or the composer's last-used values.

### Run downstream

`Run downstream` on a node is a chain of that node and the nodes that depend on it, directly or through others, in dependency order (Chains). The node's menu offers two choices, and the person picks one:

- **Run downstream: failed, waiting or never run** (`Run downstream: failed, waiting or never run (<n>)`). The node itself always runs. A downstream node joins the chain when its status is `failed`, `waiting`, `out_of_date` or `not_run`. A step stopped by a restart counts as failed.
- **Run downstream: all** (`Run downstream: all (<n>)`). Every downstream node runs, whatever its status.

The count on each item is the number of nodes that will run. Both choices end at the same chain runner, with the same confirmation and rules.

### Selection and the toolbar

- **Selection with nodes.** The selection toolbar (spec 03) gains a chain state. A selection holding one node shows `Run` (the node's own Run) and the two Run downstream choices in its menu. A selection holding several nodes, or a group that holds nodes, shows `Run chain · <n> nodes` (with ` · ~$<x>` when every paid step has an exact estimate). The hint reads `<n> nodes` (spec 03's hint style).
- **Mixed selections.** When the selection also holds usable media, Generate stays the primary button and the chain button sits beside it. The Generate composer is unchanged.
- **Only nodes.** A selection holding only nodes offers the chain button and Agent. It never offers Generate, because nodes contribute nothing to a selection run.
- **Nodes in selection runs.** A node contributes nothing to a selection-based composition, loose or inside a group, as a page or a motion does (spec 03). Its result is never sent by a selection run.

### Groups

- A group may hold a node (spec 02's member rule changes: a node is allowed, as a prompt is).
- A selected group with nodes in it shows the chain button as above, and its recipe rules (spec 06) do not change.
- A group's selection run (spec 03) ignores node members, as it ignores pages and motions.

### Page inputs

A wire from a page sends its HTML source (as `prompt` text), a picture of it (as a `reference`), or both. The role chip's menu offers **HTML** (`prompt`), **Picture** (`reference`) and **Both** (`both`). The wire keeps that choice.

- **Choice.** The wire's choice wins. A page wire with no choice takes the model's default from `pageSendDefaults` in domain. That table is empty until the evaluation (Tasks, 31) fills it. So a page wire with no choice refuses the run with `Choose what this page sends: its HTML, a picture of it, or both.` Nothing is sent on a default nobody chose.
- **Files.** A page wire also chooses `files`: `entry` (the wired file alone) or `linked` (the wired file and the project files it links to, one level deep). A page links a file when an `href` or `src` in it names a file in the project folder by its relative name. The default for `files` is set by the evaluation like the send default. A page wire with no `files` choice refuses the run with `Choose whether this page sends its linked files too.`
- **Caps.** `linked` sends at most 8 linked files and 1 MB of their text in total. Beyond that the run refuses with `This page links <n> files, <m> KB in all. Linked pages send up to 8 files and 1 MB. Send the page alone, or trim its links.` A link to a file that is not in the project folder refuses the run: `This page links <file>, which is not in the project folder.`
- **Picture.** A capture opens the wired file in headless Chrome (spec 09's finder) at a 1280 by 800 viewport, 1x, and waits for the load event plus 500 ms, as spec 09 waits for a snapshot. The capture shows the entry file, with linked files loaded as the page loads them. It is written into the project folder, not the cache (contract 8, and the index's cache rule), as `<stamp>-capture-<slug>.png` through the exclusive-write rule, with the sidecar `{ kind: "capture", source: "capture", of: <page file>, pageHash, files, viewport: { w: 1280, h: 800 }, createdAt }`. `pageHash` hashes the page file and, for `linked`, its linked files. A run reuses the newest capture whose `of`, `pageHash`, `files` and viewport match, and takes a new one otherwise. Capture is local compute with no cost.
- **No Chrome.** A picture with no Chrome found refuses the run with spec 09's sentence: `Rendering needs a Chromium browser on this computer: Google Chrome, Chromium, Edge or Brave. Install one, or point UNFRAMED_CHROME_PATH at its binary, and render again.` A run never falls back to sending less than the choice.

### The library and flows

- **Saving.** "Add to library" on a selection that holds nodes saves a flow, which is a preset (spec 06) holding the nodes, the groups and shapes saved with them, and every wire whose two ends are both in the saved set. Versions, run state and the status are not saved. Each node keeps its medium, model, params, runs and instruction. Each wire keeps its role.
- **Dropped wires.** A wire with an end outside the saved set is not saved. The save toast reads `Saved. <n> wires from outside the set were left out.`, only when `n` is above zero.
- **Inserting.** A flow inserts like any preset (spec 06): fresh ids, references rewritten, placed as spec 06 places a preset. Its nodes are not run and have no versions. Its wires are reattached to the new ids. Its input slots are empty until the person wires new inputs.
- **The chip.** The library's medium chip reads `Flow` for a flow.
- **Presets stay as they were.** A preset holding no node is unchanged. Spec 06's rule that presets carry no bytes applies: a flow carries no results.

### Persisted formats

```ts
type NodeProps = {
  w: number; h: number
  medium: "image" | "video" | "text" | "audio" | "page"
  model: string
  params: Record<string, string | number | boolean>
  runs?: number                       // image only, 1 to 10
  instruction: string
  versions: Version[]                 // newest first
  currentVersionId: string | null
  run?: { runId: string; chainId: string | null; startedAt: number }
  error?: string                      // the last failed run, cleared when the node runs again
}

type Version = {
  id: string; runId: string; chainId: string | null
  batchId: string; runIndex: number
  status: "running" | "done"
  file?: string; fileName?: string; text?: string
  fingerprint: string; createdAt: string
  error?: string                      // a durable video that failed
}

type WireProps = {
  from: string                        // shape id of the source
  to: string                          // shape id of the node
  role: "prompt" | "reference" | "first" | "last" | "both"   // "both" only on a page wire
  files?: "entry" | "linked"       // page wires only; see Page inputs
}
```

Both shapes are defined in contracts with their first migration, shared by the room and the web (spec 02). `ResultRecipe` (spec 03) and every sidecar gain `node` and, for a chain step, `chain`, both optional. The render job record (spec 04) gains a `target` naming the node and version it fills when the job is a node's. Its absence means the job fills a placeholder, as today.

### RPC methods

All over spec 01's RPC socket, failing with spec 01's `UnframedError`.

| Method | Input | Success | Failures |
| --- | --- | --- | --- |
| `node.run` | `{ project, shapeId, downstream?: boolean }` | `{ chainId, nodes: [shapeId] }` | `not_found` (no such node); `bad_request` with the messages above |
| `chain.run` | `{ project, shapeIds: string[] }` | `{ chainId, nodes: [shapeId] }` | the chain refusal, naming the step |
| `node.useVersion` | `{ project, shapeId, versionId }` | `{}` | `not_found` |
| `node.removeVersion` | `{ project, shapeId, versionId }` | `{}` | `not_found`; a running version: `That version is still being made.` |
| `flow.save` | `{ project, shapeIds: string[], name }` | the library's preset answer (spec 06), with `droppedWires` | the library's own failures |

`run.subscribe` (spec 03) gains a `chain` event, `{ type: 'chain', chainId, nodes: [shapeId] }`, at the start, and reports each step through its existing `output` and `finished` events, with the node's `shapeId` and `versionId` in place of a placeholder's shape id. Existing consumers keep working.

Validation runs for the whole chain before the first call. `chain.run` and `node.run` are not durable by themselves: a durable video step is, through spec 04's job store.

### The agent

- **`canvas_read`.** A node is `{ id, kind: "node", x, y, w, h, parent?, ref?, medium, model, params, runs?, instruction, status, versions: number, current?: { file?, fileName?, text? }, error? }`. `status` is the status name above, with its blocker where there is one. `text` carries a text version's answer. A wire is `{ id, kind: "wire", from, to, role }`. The `selection` rule is unchanged.
- **`canvas_write`.** The create op accepts `kind: "node"` (`props.medium` required; `model`, `params`, `runs`, `instruction` optional) and `kind: "wire"` (`props.from`, `props.to`, `props.role`). The update op edits a node's medium, model, params, runs and instruction, and a wire's role. `versions`, `currentVersionId`, `run`, `status` and `error` are refused with `update: <field> is written by runs`. The delete op removes a node (its wires go with it, and its files stay) or a wire. A wire is refused by `wireRefusal` with the same sentences as the person gets.
- **`node_run`.** One tool, on the in-app list and the outside list (spec 14). Input: `{ ids: string[]; downstream?: boolean; dryRun?: boolean; project? }` (`project` on outside calls only). One id runs that node; several run as a chain in dependency order; `downstream` adds the downstream nodes per the rule above.
  - Dry run answers `{ dryRun: true, steps: [{ node, prompt, references, estimate }], estimate, spendLimit }`. It writes nothing, calls nothing and is never refused by the limit (spec 14).
  - Accepted answers `{ chainId, nodes: [shapeId], status: "running" }` once the node carries its run marker. The agent follows it with `canvas_read`.
  - Outside spend limit: the chain's estimates are summed and checked before the first step, and each step reserves its estimate as it starts (spec 14's reservation rule). A refusal writes nothing and names the step.
  - In-app, Supervised mode asks once for the chain, naming its steps and estimate, as spec 14 asks for `generate`. Full access runs it at once. Plan mode refuses it with `assets/prompts/plan-no-writes.md`.
- **Attribution.** Every call sets `chat: {id, turn}` on each step's run (spec 03). A version's creation and fill are turn changes of that turn, as spec 14 says of `generate`'s placeholders, so Revert this turn removes an unfilled version and a node the turn created. A revert never deletes a file.
- **Selection.** The selection preamble (spec 07) names a node `node <id> ("<label>")`.
- **Descriptions.** The tool descriptions in `assets/prompts/tool-descriptions.md` and the sentence on refs in `assets/prompts/agent-system.md` change at build time to name nodes and wires, as spec 15 does for audio. `node_run`'s description is new and written in the same file.

### Rules this spec bends

00-index requires a spec that bends a shared rule to say so and why. This one bends the following, and keeps the rest.

1. **Index, The product**: "There are no wires and no output nodes: **the selection is the input set**." The selection is still the input set of a selection run. A node's inputs are its wires, a second and persistent input set. Why: the issue asks for persistent cards, and the research (`docs/research/node-parameters.md`, option B) found that a card and wires need no change to a run's rules.
2. **Index, Vocabulary**: `Shape` gains `node` and `wire`. `Result` gains "or a version of a node". `Selection` says it is the input set of a selection run. `Placeholder` gains spec 16's version records, which use the same lifecycle.
3. **Spec 02, Shape kinds and Out of Scope**: "Wires, edges, handles and output nodes no longer exist" is replaced. Wires and nodes exist as this spec describes. tldraw's own arrow connectors stay off, and edges and handles of tldraw's shapes stay off. The member rule gains a node. The add menu gains a node.
4. **Spec 03, Out of Scope**: "A result strip, 'Add to canvas' and 'Clear'" keeps its rule for the composer. Node versions are a strip inside the node (spec 16). The placeholder lifecycle gains version records. A node is excluded from selection composition, as artifacts are.
5. **Spec 04**: roles on a video node come from its wires. The render job record gains `target` for a node's job. Its selection rules are unchanged.
6. **Spec 06**: a node is groupable. A group run ignores node members. A library flow is a preset kind. Recipe groups and presets without nodes are unchanged.
7. **Spec 07**: the canvas tools gain the node and wire kinds, and `node_run` joins the server's tools. Spec 07's `rename` op covers a node, as it covers every shape with an `@id`.
8. **Spec 14**: `node_run` joins the outside list and the in-app list. Its spend limit applies to every step.
9. **Spec 15**: its statement that the rewrite has no nodes and no wires is updated. Audio is still never an input (this spec keeps that rule).
10. **Spec 09**: a node's page run is a second writer of page files, and a page capture is a new project file kind. Spec 09's Artifact files section gains a paragraph for both.

This pull request updates each passage named above, so the specs keep describing the app.

Not bent: contract 4 (every paid run leaves a sidecar with its cost), contract 9 (the canvas thread: a node's editor mounts only while it is live), contract 2 (the OpenRouter key stays in the engine), and the hosting contract (spec 01). Spec 11 (legacy import) is not changed (Open decisions, 7, decided).

## Testing Decisions

A good test drives one of the three seams in 00-index and asserts on what it exposes: return values, RPC answers and events, the room's shapes, the files and sidecars in the project folder, the stub OpenRouter and stub ElevenLabs requests, and what a person sees. No test reaches into the run registry, the chain runner or React state.

- **Domain seam** for every rule with many cases: `wireRefusal` for each refusal, in both orders of wires; `rolesFor` for each medium and each model that takes frames or does not; `nodeRequest` placing every role as the role table says, for every role and media mix (a role the model takes is in the array at its position; a role it does not take is in neither array); `inputFingerprint` stable under reordering of unrelated shapes and changing with each input it names; `nodeStatus` for each state and its priority; `planChain` for dependency order, canvas-order ties, group expansion, a node outside the chain with and without a result, and a loop; `flowFrom` and `flowInsert` for dropped wires and rewired ids. Table-driven Vitest, one row per case.
- **Engine seam** with the real engine and the stub OpenRouter (and the stub ElevenLabs, for audio nodes). Covers `node.run` from validation to a filled version, every node message, the version lifecycle (running, done, removed on failure, durable failure kept), the chain runner (order, pre-validation refusal naming a step, a failure that stops the chain, nothing spent after it, a restart that stops a chain, a durable video step that holds the next step), the boot resolution of running versions, `flow.save` and insert, the agent tools (`canvas_read` and `canvas_write` for nodes and wires, the refusals, `node_run` dry and accepted, the outside spend limit for every step, the in-app approval).
- **Browser seam** for the node card (live when selected, summary when not), the composer on a node (the tray, the instruction and its persistence), drawing a wire and each refusal sentence, the role chip and its menu, reordering references, the status lines, Run and Run downstream, the chain button on a selection and in a group, the mixed selection with Generate, the versions strip (use, remove, drag out), undo keeping a landed version, saving and inserting a flow.
- **Domain seam** for page rules: `pageAnswer` (one full document, a fragment, an empty answer, a fenced document); `pageTitle`; `pageSend` (an explicit choice, the table's default, a page wire with neither refused with its sentence); `linkedFiles` (`href` and `src` to project files, a missing link refused, the 8-file and 1 MB caps and their sentences).
- **Engine seam** for a page version (the page file and sidecar written through spec 09's writer, a rejected answer kept as `<stamp>-page-rejected.txt` with its cost, the run failing with its message) and for a capture (written as a project file with its sidecar, reused while the page hash matches, retaken when it changes, refused with spec 09's no-Chrome sentence). The capture test skips, saying so, where no Chrome is found, as spec 09's does.
- **Browser seam** for the page medium's preview, the drag out as a page shape, and the send choice and Files choice on a page wire.
- **The evaluation** (Tasks, 31) is not a test. It spends money, so the person runs it, and it stays out of CI.
- Prior art: spec 15's tests for an alternate medium's run and status, spec 05's batch tests, spec 04's roles and request tests, spec 06's preset tests, spec 14's `generate` tests for spend and dry run.

## Tasks

1. Wire rules: each refusal sentence, the roles each medium and model offers, the frame roles only when the model takes frames, the loop check on a graph. Seam: domain.
2. Role by source: the table in Implementation Decisions for every source kind, including a group's member roles, a mark on an image, a motion with and without a render, and a node's text and media versions. Seam: domain.
3. Node request: prompt text in wire order, references numbered by input-list order, frames, the instruction's `@` pictures after the wired slots, sources expanded for groups; roles and request agree in every case. Seam: domain.
4. Input fingerprint and node status: each status, its priority, the blocker's name, and a stable hash under unrelated edits. Seam: domain.
5. Chain planner: group expansion, canvas-order ties, dependency order, an outside input with and without a result, a loop. Seam: domain.
6. Flow rules: keeping the wires inside the saved set, the dropped count, fresh ids and rewired ends on insert. Seam: domain.
7. Contracts: the `node` and `wire` shapes with their first migration; `Version`; the sidecar's `node` and `chain` fields; the render job's `target`. The room accepts a node and a wire and refuses a wire whose ends are not shapes. Seam: engine.
8. Node run service: validation for each message, the running version written before the call answers, the fill on landing, the removal on a non-durable failure, a durable video failure kept with its error, the current version chosen by the lowest run index. Seam: engine.
9. Boot resolution of versions: a running non-durable version with no live run is removed at boot; a durable one is left to the job store. Seam: engine.
10. Chain runner: order, one step at a time, pre-validation of every step, a failure that stops the chain with the downstream nodes waiting and nothing spent after, a restart that stops unstarted steps, a durable video step holding the next. Seam: engine.
11. Spend in chains: the outside limit summed before the first step, a reservation per step at its start, a refusal that names the step and writes nothing; the in-app approval once per chain. Seam: engine.
12. Run downstream: both choices, the statuses the first one includes, the node itself always running, and the menu counts. Seam: engine.
13. Version operations: use, remove (the file stays, current moves to the newest remaining), and the refusal on a running version. Seam: engine.
14. Agent tools: `canvas_read` for nodes and wires; `canvas_write` create, update, delete and the refusal of run-written fields; `node_run` dry run and accepted answers; the spend limit and attribution on each step. Seam: engine.
15. Flow RPC: `flow.save` with `droppedWires`, `flow.insert` with fresh ids and no versions. Seam: engine.
16. Node shape util: the summary when not selected and the live composer when selected; the card size limits; the label rule. Seam: browser.
17. Node composer: spec 03's tray and instruction editor on the node; the instruction persists; Cmd+Enter runs the node; the last-used values start a new node. Seam: browser.
18. Wire drawing: the handle, a drop onto a node, each refusal toast, a wire to a deleted source removed, Delete on a selected wire. Seam: browser.
19. Role chips: the menu lists only the roles the medium and model take; a second frame wire is refused; references numbered by the input list; a drag reorders them. Seam: browser.
20. Versions strip: the newest shown, use this version, remove version with the file kept, drag a version out as an ordinary shape with its recipe. Seam: browser.
21. Status and runs: the status line for each state, Run disabled while running, Run downstream's count, a failed run's message kept until the next run. Seam: browser.
22. Chains on the canvas: the chain button for one node, several nodes and a group; the mixed selection with Generate; the only-nodes selection with Agent; the chain's progress and its failure on the nodes. Seam: browser.
23. Undo: an edit to a node undone, a landed version kept after Cmd-Z. Seam: browser.
24. Library: saving a flow with its wire count note, inserting it into another project with empty inputs and no versions, the `Flow` chip. Seam: browser.
25. Page output, domain: `pageAnswer` for a full document, a fragment, an empty answer and a fenced document; `pageTitle`. Seam: domain.
26. Page output, engine: a version's page file and sidecar written through spec 09's writer; a rejected answer kept as `<stamp>-page-rejected.txt` with its cost; the run failing with the message. Seam: engine.
27. Page output, browser: the page medium's preview inside the node; the drag out as a page shape with its title. Seam: browser.
28. Page inputs, domain: `pageSend` (explicit choice, the table's default, neither refused with its sentence); `linkedFiles` (`href` and `src` to project files, a missing link refused, the caps and their sentences). Seam: domain.
29. Page inputs, engine: a capture written as a project file with its sidecar; reused while the page hash matches and retaken when it changes; refused with spec 09's no-Chrome sentence where no Chrome is found (skipped with a note where there is none, as spec 09 does). Seam: engine.
30. Page inputs, browser: the role menu on a page wire offers HTML, Picture and Both; the Files choice appears on a page wire. Seam: browser.
31. Evaluation, not a test (it spends money, so the person runs the paid calls). Before tasks 28 and 29 set their defaults: a set of five pages (a single-file prototype, a motion composition's page, a multi-file prototype with linked CSS and a second page, a text-heavy layout, an SVG or canvas drawing); each sent to the image and video models the composer offers, as HTML, as a picture, and as both, and with linked files alone and with them; each answer scored against its page by a written rubric; results in `docs/research/page-inputs.md`; then `pageSendDefaults` and the default `files` set from them. The agent may prepare the page set and the harness when the build starts; the person runs the paid calls.

## Out of Scope

- Motions as node outputs. A node writes pages in this version. A motion is a HyperFrames composition and a render, which spec 09's motion tools own.
- Linked page files beyond the caps in Page inputs (8 files, 1 MB of text).
- Captures of more than the viewport (no full-page capture), and captures of motions. A motion's MP4 render is already an input (Wires).
- Audio as a wire source or a node's output (spec 15).
- Free mode on a node (spec 05), and batches of a list over a node's inputs.
- Value nodes that drive a setting through a wire. Settings are the tray's dropdowns and toggles.
- Parameter sweeps and cartesian batches over a node's settings.
- Caching a node's result to skip a run. Staleness is flagged; a run only happens when asked.
- Parallel steps within a chain.
- Continuing a chain after an engine restart.
- Pulling a node's result into a selection-based Generate.
- Nodes in a library preset that is not a flow.
- Changing legacy import: old output nodes stay recipe groups (spec 11, decided).

## Open decisions

None open. The seven questions were answered and are in the spec:

1. Wire form: a dedicated connection shape (Terms, Wires). Its look waits on the person's reference image (Further notes).
2. Selected shapes never join a node's run (Running one node).
3. Run downstream offers two choices: failed, waiting, out of date or never run; or all (Run downstream).
4. A chain with two or more paid steps asks once before it starts (Chains, Confirmation).
5. A node can write a page in the first build (Page output).
6. A page can feed a node as HTML, as a picture, or as both, with a linked-files choice (Page inputs). The per-model defaults wait on the evaluation (Tasks, 31).
7. Spec 11 stays as it is: old output nodes import as recipe groups.

## Further Notes

- **How the answers map to this spec.** The user answered the six design questions in #103: results as versions, each a normal file (Solution, The node; Versions); each node's own Run and Run downstream, and a chain from a selection or a group (Running one node, Chains, Run downstream); wires with roles that replace top-to-bottom order (Wires); a failed step stops what follows (Chains, Failure); a saved flow as a preset with its nodes and wires (The library and flows); agents read, write and run nodes (The agent). The seven review questions are settled in Open decisions.
- **Known gaps.** (1) The connection shape's look: the user will send a reference image, and until then the look in Wires is provisional. (2) Page input defaults: set by the evaluation (Tasks, 31). A page wire refuses its run until its send and Files choices are set, so nothing is sent on a default nobody chose.
- **Reading of "after".** This spec reads "after" as every later step of the chain, so a branch that does not depend on the failed node also waits. That spends less and matches the words. If the Pivot wants independent branches to finish, that changes Chains, Failure.
- **Groups.** The user wrote that a chain runs "if they're all in a group". A group's members are the chain's nodes (Chains, What a chain is). A node inside a group is still one node: its wires are its wires.
- **Research.** `docs/research/node-parameters.md` (PR #112) recommended option B: a card with prompt, model and settings, inputs by wires, one run that is spec 03's run with the wired shapes as the input set. This spec follows B and adds the chain rules the user asked for. The research's cache-by-input idea (ComfyUI, Krea) is reduced to a staleness flag, because the index's pay-per-run rule forbids a run that repeats or skips silently. Its performance note (contract 9) is followed: a node's editor mounts only while the node is live.
- **Why no value wires.** The research shows OpenRouter's settings are mostly lists, so wiring a number or a seed into a setting buys little yet. A seed control, as spec 03 already leaves open, is the first place a value wire would pay.
- **Pages.** Page output adds one moderate piece to spec 09: a second writer of page files and a snapshot for node versions, both on spec 09's existing rules. Page inputs add the capture step, which uses spec 09's headless Chrome finder. The evaluation decides what each model reads well: text models read HTML as text, while image and video models may read HTML poorly, in which case a picture is what they need. Multi-page HTML is handled as a page file that links other project files, sent alone or with its linked files within the caps; the default follows the evaluation.
- **Assets this spec needs.** A new wording of `node_run`'s description, and the node and wire sentences in `assets/prompts/tool-descriptions.md` and `assets/prompts/agent-system.md`, both written at build time. No model-facing text is needed for captures.
