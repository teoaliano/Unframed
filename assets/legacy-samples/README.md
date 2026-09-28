# Legacy samples

Old-format files for spec 11 (legacy import). The domain, engine and browser seams all use them as fixtures. Tests copy this folder into a temp output folder and work on the copy. Never edit these files in place, and never let a test write here.

This folder stands in for an old output folder: `jobs.json` and `presets.json` sit at its root, and each subfolder is one project. All content is invented (a fox, a cliff, a hiker in a yellow jacket and brown boots). Nothing comes from a real user folder.

The PNGs are 64 by 40 and the MP4s are 1 second at 160 by 90, all made with ffmpeg. Every inline `data:` URL is a real 64 by 40 PNG.

## Layout

```
legacy-samples/
  jobs.json
  presets.json
  everything/          the main project: every node type and every mapping rule
  legacy-snapshot/     graph.json with no version, beside a non-empty graph.log
  broken-snapshot/     graph.json that is not valid JSON, beside a graph.log that rebuilds it
```

## everything/

### graph.json

`version` is 4. It holds 41 nodes and 14 edges. Old autosaves left stale keys on some nodes: `selected` and `measured` on 100, `dragging` on 106, and `extent` on the two members 120 and 121. The importer must ignore all of them.

In the table, "rule 1", "rule 2" and "rule 3" are spec 11's three rules for where a recipe goes (one group, a box around the sources, where the output stood).

| id | type | what it covers |
| --- | --- | --- |
| 100 | prompt | `sized: true`, 320 by 100 (a fixed size). References another prompt (`@101`). Source of 140. |
| 101 | prompt | Hugs its text (no `sized`). Source of 132. Journal entry 6 changes its text from "red fox" to "lone red fox". |
| 102 | prompt | References a text output with an answer (`@170`). |
| 103 | prompt | References a group. It reads `@hero` in the snapshot, and journal entry 7 rewrites it to `@character`. |
| 104 | prompt | References an unknown token (`@lighthouse`). Journal entries 8 and 9 remove it and undo the removal, so it survives. |
| 105 | prompt | References the text output with an empty answer (`@133`). |
| 106 | image | `data.file` exists, with no `aspect`, so the height comes from the PNG header (64 by 40, so 150 at width 240). Source of 140. |
| 107 | image | Inline PNG `data:` URL, `fileName` "sketch.png", no `file`. Extracts to `legacy-5c59251f1b05f008-sketch.png`. |
| 108 | image | Empty (`fileName: ""`, `dataUrl: ""`). It overlaps prompt 191, so it blocks rule 2 for output 190. |
| 109 | image | `data.file` names `1789031280088-gone.png`, which is not on disk. It becomes an empty shape and a "missing" item. |
| 110 | video | `data.file` exists, with an upload sidecar. |
| 111 | video | `dataUrl` holds an `https://` link (with a query string). It becomes a linked reference clip. |
| 202 | video | Names a motion render MP4 with a `source: "render"` sidecar. It stays a plain video, not a result. |
| 210 | image | `parentId: "old-box"`, which names no node. It becomes top level at (1300, 2150). Its file has a `source: "copy"` sidecar, so it is not a result. |
| 220 | sticky | Unknown type. It is dropped and reported. |
| hero | group | Renamed to `character` by journal entry 7. Carries a stray `data.name: "Hiker"`, which the importer ignores. Members: 120 (prompt, the hiker in the yellow jacket and brown boots) and 121 (image). |
| 120, 121 | prompt, image | Group members, with positions relative to the group. |
| 141 | image | Names result run 1 of output 140 (the old "Add to canvas"). That file has an image generation sidecar, so this shape becomes the result in place and output 140 does not create it twice. |
| 140 | imageOutput | `results` for runs 1, 2 and 3 (runIndex 0, 1 and 2 in node data). Run 1 is already on the canvas as 141, run 2 exists only in the strip, and run 3's file is missing. Its sources 100 and 106 are loose and unshared, so rule 2 applies. |
| 132 | text (legacy) | Legacy type, becomes `textOutput`. Empty instructions, empty answer. Its source 101 would be boxed, but that box overlaps the recipe group made earlier for 140, so rule 3 applies. |
| 151 | textOutput | The Layerize planner. Sources 153 and 152. It has an answer (three sections split by `---`) with a matching text sidecar and no instructions. 152 also feeds 150, so rule 3 applies. |
| 150 | imageOutput | Free (`freeRuns: true`) with `previewPrompt: true`. Wired from text output 151 and image 152, which also feeds 151: the Layerize shape. Shared sources, so rule 3. |
| 153, 152 | prompt, image | The planner prompt and the picture it reads. |
| 160 | videoOutput | `data.result` names a finished MP4 with a video generation sidecar. `inputMode: "first_frame"`. Sources 161 and 162, so rule 2. |
| 163 | videoOutput | `data.job` names `vid_2f8c1e7a9b`, which `jobs.json` lists as pending for this project. `shareLocalVideos: false`. Source 164, so rule 2. |
| 170 | textOutput | Instructions and an answer. Source 172, so rule 2 with the instruction prompt at the bottom of the box. Three text sidecars share its prompt text: 09:55 and 09:58 match the answer exactly, and 10:01 (a different prompt) does not. The recipe must come from 09:58, the newest exact match (cost 0.0004). Also carries an old `size` field, which the importer ignores. |
| 133 | textOutput | Instructions and an empty answer, referenced by prompt 105. Source 134, so rule 2. |
| 180 | imageOutput | Wired from exactly one group (`hero`, later `character`), so rule 1 puts the recipe on the group. Exact `size: "1024x1536"`, `quality: "high"`, `runs: 3`. |
| 130 | output (legacy) | `kind: "image"`. No edges: the unwired output (rule 3, "no sources"). |
| 131 | output (legacy) | `kind: "video"`. No edges. `data.job` names `vid_7d3a0c5e11`, which `jobs.json` lists as failed. |
| 190 | imageOutput | Has a `running` marker, which is dropped and reported. Source 191. Its box overlaps image 108, so rule 3 applies. |
| 200 | page | `data.dials` holds saved values. Its file has a `source: "agent"` sidecar. |
| 201 | motion | Its file has a `source: "agent"` sidecar. |
| a-mfd4b1x9-q7c3v1 | prompt | Not in the snapshot. Journal entry 5 adds it with an agent-style id. |

Edges: 14 in total. Most have `animated: true` and some have no `animated`. `xy-edge__172out-170in` carries `sourceHandle` and `targetHandle`. After replay, the edge `e-hero-180` has `source: "character"` and keeps its old id.

### graph.log

JSON lines, 13 physical lines. Every inverse is exactly what the old server computed.

| line | version | what it covers |
| --- | --- | --- |
| 1 to 4 | 1 to 4 | History that the snapshot already holds. Replay skips them, because their versions are not above 4. |
| 5 | 5 | `addNode` of the agent prompt, origin `thread`. |
| 6 | 6 | `batch`: two `updateNode` with a `patch` (one sets `null` to delete a key) and a `resizeNode`. |
| 7 | (blank) | A blank line. Replay skips it. |
| 8 | 7 | `batch` holding `renameNode` of group `hero` to `character`, plus the `updateNode` that rewrites prompt 103's token, as the old app composed a rename. |
| 9 | 8 | `removeNode` of prompt 104. |
| 10 | 9 | Undo entry: `origin.kind: "undo"`, `undoes: 8`, and the op is entry 8's inverse, which puts 104 back at index 5. |
| 11 | 10 | Rejected: `reparentNode` of output 180 into a group. An output cannot be a member. Replay skips it and goes on. |
| 12 | 11 | `moveNode` of the agent prompt. It applies, so the final version is 11. |
| 13 | (torn) | Not valid JSON and no trailing newline. Replay stops here, and the report says "graph.log has an unreadable line 13." |

`graph.log.stale-1789031400000` is a journal the old app set aside. The importer never reads, renames or deletes it. If it were applied, it would rename prompt 101 to "arctic fox".

### Media and sidecars

| file | what it is |
| --- | --- |
| `1789030860011-cliff.png` + `.json` | Upload for image 106 (`source: "upload"`). |
| `1789030920022-hiker.png` + `.json` | Upload for group member 121. Also named by the "Hiker character" preset. |
| `1789030980033-sea.png` + `.json` | Upload for image 152. |
| `1789031040044-fox-sitting.png` + `.json` | Upload for image 162 (original name "fox sitting.png"). |
| `1789031100055-grass.png` + `.json` | Upload for image 172. |
| `1789031160066-waves.mp4` + `.json` | Upload for video 110. |
| `1789031220077-cliff.png` + `.json` | Copy for image 210 (`source: "copy"`, with `of`). Not a result. |
| `2026-09-10T09-30-07-000Z-a-red-fox-standing-on-a-windswept-cliff--1.png` + `.json` | Image generation, run 1 of 3 for output 140. The double hyphen is real: the old slug cut the prompt to 40 characters, which ended on a hyphen. |
| `2026-09-10T09-30-14-000Z-a-red-fox-standing-on-a-windswept-cliff--2.png` + `.json` | Image generation, run 2 of 3. Run 3 (`...--3.png`) is missing on purpose. Sidecars use `runIndex` 1 to 3, and node data uses 0 to 2, as the old app wrote them. |
| `2026-09-10T09-40-00-000Z-the-fox-turns-its-head-toward-the-camera.mp4` + `.json` | Video generation for output 160 (`kind: "video"`). |
| `2026-09-10T09-50-00-000Z-text-list-every-separate-part-of-image-1-writ.json` | Text run sidecar for 151. It matches its answer. |
| `2026-09-10T09-55-00-000Z-text-describe-image-1-in-one-sentence.json` | Text run sidecar for 170, older exact match. |
| `2026-09-10T09-58-00-000Z-text-describe-image-1-in-one-sentence.json` | Text run sidecar for 170, newest exact match. |
| `2026-09-10T10-01-00-000Z-text-name-three-colours-in-image-1.json` | Text run sidecar that matches no answer. |
| `1789035000101-fox-landing.html` + `.json` | Page 200's file and its agent sidecar. |
| `1789035300202-cliff-intro.html` + `.json` | Motion 201's file and its agent sidecar. |
| `1789035600303-cliff-intro.mp4` + `.json` | A render of the motion (`source: "render"`, with `dials`), named by video 202. |
| `1789035001001-agent.json` | Agent turn sidecar (`kind: "agent-turn"`, `billing: "subscription"`). The importer ignores it. |
| `unframed-dials.js` | A stand-in for the old generated motion support files. The importer ignores it. |
| `threads/t-mfd3k8q2-4c7e9a1d.json` | One old chat. Not imported, so the report adds the chats line. |

Results name their files as `/api/file/everything/<name>` and as a `savedPath` under `/Users/sample/Unframed/output/everything/`. That folder does not exist on the test machine, so only the basename resolves.

## legacy-snapshot/

- `graph.json` has no `version` and no `edges` key (read as `[]`), so it is a legacy snapshot. It holds a prompt, an image with an inline PNG `data:` URL (extracts to `legacy-af3411e27cb1bd79-beach.png`), a legacy `output` with no `kind` (so an image output) whose one result `url` is a `data:` URL with no `savedPath` (extracts to `legacy-cf4b71560e735285-upload.png`), and a `videoOutput` whose `job` is `vid_4b9e2d6f03`. Node 100 carries `selected: false`.
- `graph.log` has two entries. Because the snapshot is legacy, the importer must ignore them. If they were applied, prompt 100 would say "wolf" and a prompt 104 would appear.
- `2026-09-10T12-20-00-000Z-a-fox-running-along-the-beach-at-low-tid.mp4` + `.json`: the clip that `jobs.json` records as done for this project. It becomes the video output's result.

## broken-snapshot/

- `graph.json` is cut off mid-object and does not parse. The importer rebuilds from the journal and reports "graph.json could not be read, so the canvas was rebuilt from graph.log."
- `graph.log` has three entries that build a prompt, an image, a `videoOutput` and two edges from nothing, and then set the output's `job` to `vid_9a1c7e3b58`.
- `1789048800005-snow.png` + `.json`: the image's upload.
- The job id `vid_9a1c7e3b58` appears in `jobs.json` only under `project: "other-project"`. The lookup is by id among this project's records, so the report says "not found".

## jobs.json

| id | project | status | covers |
| --- | --- | --- | --- |
| `vid_2f8c1e7a9b` | everything | pending | Output 163's render in flight. |
| `vid_7d3a0c5e11` | everything | failed | Output 131. Has `error` and `resolvedAt`. |
| `vid_4b9e2d6f03` | legacy-snapshot | done | Has `savedPath` and `cost`. The clip is on disk. |
| `vid_9a1c7e3b58` | other-project | pending | Same id as broken-snapshot's job, under another project. Has `unreachableSince`. |

`startedAt`, `resolvedAt` and `unreachableSince` are epoch milliseconds, because the old `jobs.js` wrote `Date.now()`. Spec 11's `LegacyJob` type says `string`. The importer does not read these fields, but the type in the spec should say `number`. Key order follows the old store (`startedAt` first, `id` last).

## presets.json

Five entries. The first is in spec 06's current format and the other four are old entries with no `format` key, in the order a real mixed file has them (new saves go first).

| id | name | covers |
| --- | --- | --- |
| `user-mfe1q9w2` | Fox on the cliff | Spec 06's current format (`format: 2`, `kind: "group"`). See the note below. |
| `user-mf2k8a1c` | Split into parts | A flow with an output: planner prompt, text output, Free image output, empty image, wired as the old Layerize. The image output carries a captured `results` entry, so "Its old results were not kept." applies. The text output feeds the image output, so it loses its model. It has `needs`. Its `kind` is `"text"`, because the old save took the first output in node order. |
| `user-mf1x9k4b` | Fox walk clip | Holds an image with a `data:` URL. Also covers: an `https://` video link, a video output as the recipe output with a `job` marker, a second (image) output with a `running` marker that is not kept, a group `pose` that gets flattened into the preset's group, and a page that is dropped. |
| `user-mf1b5y2e` | Detail list | A block that is a lone text output with instructions. |
| `user-mf0a3z7d` | Hiker character | A block with no output: group `character` with a prompt member and an image member whose `file` names `1789030920022-hiker.png` with no project. It has no `savedAt`, like the earliest saves. |

### The spec 06 entry is hand-written

`user-mfe1q9w2`'s `content` was written by hand, not copied from tldraw. It holds one `frame` shape (the group, `props.name: "fox-cliff"`) with two children: a `text` shape (`meta.ref: "100"`) and an `image` shape (`meta.ref: "101"`), plus one image asset record and a `schema` object. Once spec 06 exists, the implementer should regenerate this entry from a real tldraw copy if tldraw's schema rejects it. Two choices here are mine, because spec 06 does not fix them:

- The portable file pointer is the asset's `props.src` set to `preset-file:everything/1789030860011-cliff.png`, meaning project `everything`, file `1789030860011-cliff.png`. That file exists in `everything/`. tldraw's default asset validator only accepts http, https, data and asset URLs, so spec 02's `project-file:` marker and this pointer both need the same validator allowance.
- The `schema.sequences` numbers are plausible tldraw values, not ones taken from a real store. The text shape uses `richText`.

## Numbers worth knowing

- Extracted file names use the first 16 hex characters of the SHA-256 of the PNG bytes: `5c59251f1b05f008` (image 107, and the `sketch` image in "Fox walk clip", which has the same bytes), `af3411e27cb1bd79` (legacy-snapshot image 101), `cf4b71560e735285` (legacy-snapshot's data URL result).
- The highest numeric id in `everything/graph.json` is 220 (the sticky, which is dropped). The highest one that survives the import is 210.
