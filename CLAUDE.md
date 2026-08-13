# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Kept deliberately short, because it loads into every session. It holds what applies to *any* change; topic detail lives in the docs indexed below, read when you work in that area.

## What this is

Unframed: a local, node-based image generator. A React Flow canvas lets you wire `prompt`, `image` and `video` input nodes into one of three output nodes — image, video or text — and clicking Generate calls the matching model (GPT Image 2 by default) through OpenRouter, writing the result plus a `.json` sidecar to disk. A text output can run a prompt through a text model first, and its answer feeds back in by `@id`. No hosting, pay-per-generation.

## Commands

```bash
npm run install:all   # installs root (engine) + client (each has its own package.json)
npm run dev           # runs server (8787) and client (5173) together via concurrently
npm run server        # server only (node --watch)
npm run client        # client only (vite)
npm test              # assert-based self-checks, no framework
```

Requires Node 18+ (server relies on built-in `fetch`). No lint setup exists. `npm test` runs `client/src/graph/resolve.test.js` plus `server/env.test.js`, `share.test.js`, `presets.test.js` and `host.test.js` — plain `node`, no test framework, no fixtures.

Config lives in `.env` at the project root (copy from `.env.example`): `OPENROUTER_API_KEY`, `OPENROUTER_IMAGE_MODEL` (was `OPENROUTER_MODEL`, still read as a fallback and retired from the file the first time the new name is written), `OPENROUTER_TEXT_MODEL`, `OPENROUTER_VIDEO_MODEL`, `OUTPUT_DIR`, `PORT`. Everything except `PORT` is editable in the app's settings dialog. The client dev server proxies `/api` → `http://localhost:8787` (see `client/vite.config.js`), so both must be running.

## Where things are documented

One home per rule. Never document the same thing in two files — pick the one that owns it and link from the other.

| File | Owns |
| --- | --- |
| `CLAUDE.md` (this) | how the code works, present tense — the parts that apply to any change |
| `docs/models.md` | catalogues, model-driven controls, multi-run |
| `docs/video-and-sharing.md` | video references, the two video-to-video modes, the share tunnel |
| `docs/library.md` | presets, `presets.json`'s write rule, the Library dialog |
| `docs/releases.md` | versioning, tagging, the PR workflow, and the invariants that keep this repo consumable by the desktop shell — **read before tagging or touching `package.json`** |
| `docs/superpowers/specs/` | the reasoning behind one piece of work, including what was rejected |
| `status.md` (gitignored) | the roadmap and its decisions, future tense — including what was decided NOT to build |
| `CHANGELOG.md` | user-visible changes, dated. Its header states its own format |

The test for where something goes: **if it were deleted, what breaks?** An agent writing wrong code → here. Re-proposing a settled decision → `status.md`. A user not knowing what changed → `CHANGELOG.md`.

## After a change

Before calling a piece of work done:

1. **`npm test`**, and add a case if the change touched pure logic. Node components have no tests by design — verify those in the browser and say so.
2. **`CHANGELOG.md`** — a dated entry if a user would notice. User-visible only; refactors and test commits do not appear, the git log is already the exhaustive record.
3. **`status.md`** — delete any todo this closed. If you decided *not* to build something along the way, record it under "Decided not to build" with the reasoning, so it is not re-proposed in six weeks. Do not add a todo for something nobody intends to build; a checkbox reads as intent.
4. **Documentation** — if behaviour changed, update the file that owns it, here or in a topic doc. If a topic has grown past a few paragraphs, give it its own doc and leave a row in the table above rather than letting this file swell.

## Architecture

Two-package monorepo, no shared build: the root IS the engine package (`server/` has no `package.json` of its own — its dependencies are the root's, so the repo can be installed as a single unit by the desktop shell), and `client/` is a separate Vite build. The only non-trivial logic is in `client/src/graph/resolve.js` — read it first.

**Data flow:** `ImageOutputNode.onGenerate` → `buildRequest(nodes, edges, outputId)` (pure, in `resolve.js`) → `POST /api/generate` (via `client/src/api.js`) → server's `/api/generate` handler → OpenRouter `POST /api/v1/images` → image written to disk + returned as a data URL to the browser. The other two mirror it: `TextOutputNode.onRun` → `POST /api/text` → OpenRouter `chat/completions` → result stored in `node.data.result`; `VideoOutputNode.onGenerate` → `POST /api/video`, then polls `/api/video/:id` until the server has downloaded the finished file.

**Key design decisions:**

- **Only output nodes consume edges** (all three of them). `resolve.js` asks `isOutput(n)` — `n.type.endsWith('Output')` — rather than listing type strings, because that list was repeated in five places and adding a third output type meant extending each of them. Its partner `isTextOutput(n)` is separate because getting *it* wrong is silent: `resolveRef` would fall through to substituting a text node's `data.text` (its instructions) instead of `data.result` (the model's answer), and generations would quietly build from the wrong text. Wiring is always "sources → output."
- **`@id` composes prompts, not edges.** `resolveRef` recursively substitutes `@id` references (`TOKEN_RE = /@([\w-]+)/g`) and throws on cycles; unknown ids resolve to empty string. A text output's `data.result` is substituted **literally** — never re-scanned for `@` tokens, which would let model output pull in arbitrary prompts, and which makes reference cycles terminate with a stale string instead of hanging.
- **Source ordering is by node Y position** (top-to-bottom), so canvas layout determines prompt concatenation order. Prompt parts are joined with `\n\n`; reference media become `input_references`. Numbering is per consumer *and* per kind — `imageRefNumbers` returns one rank per consuming node, because an image can be image 1 to a text output and image 2 to an image output at once; the badge shows `1 / 2` when they diverge.
- **Old node types are migrated on the way IN, never rewritten on disk.** `migrateNodes` in `graph/migrate.js` maps the pre-2026-08-13 `output` (+ `data.kind`) and `text` types onto `imageOutput`/`videoOutput`/`textOutput`, and runs in exactly two places: `loadProject` in `api.js` — the single funnel every graph read goes through, chosen over the two call sites in `App.jsx` precisely because one of those would eventually be forgotten — and `instantiateFragment`, through which every preset reaches the canvas. A project self-heals on first open, since the next autosave writes the migrated shape back. **`presets.json` is deliberately left stale** (see `docs/library.md` for why that write path is dangerous). The migration is permanent, not transitional — deleting it would silently break any graph or preset not opened since. The predicates return `false` for the old ids, so an unmigrated graph has no consumers and fails loudly rather than half-working.
- **The API key lives in the server process** — the client only talks to `/api`, and the only key material sent back is the last 4 chars (`keyHint` on `/api/health`). `.env` is therefore generated, not a prerequisite.
- **`.env` is written through one funnel.** `server/env.js` holds `upsertEnv(text, updates)` (replace-in-place, append when missing, `null` deletes the whole line so a shell-provided value isn't shadowed by an empty string) and `PATTERNS`, the per-variable validators — the trust boundary, since these strings reach a shell-ish file and, for the key, an HTTP header. `PUT /api/config` takes any subset of `{key, imageModel, textModel, videoModel, outputDir}`, validates, `mkdir -p`s a new output dir *before* saving so a bad path fails with a message instead of at generation time, writes, then reassigns the module-level bindings (all `let`) so nothing needs a restart. `DELETE /api/key` is the same path with `null`. Tested in `server/env.test.js`.
- **The server runs standalone or hosted, on one code path.** Three environment variables, all unset in a clone, let an Electron shell host it: `UNFRAMED_DATA_DIR` moves `.env` and the default output folder off the project root (in a bundle that root is read-only, so a key written there fails or vanishes on update), `UNFRAMED_CLIENT_DIST` serves the built canvas from the same origin as the API, and `PORT=0` takes an OS-assigned port reported back with `process.send({ type: 'ready', port })`. The same channel carries `{ type: 'reveal', files }`, so the shell calls `shell.showItemInFolder` and the app never sends the Apple Event that would need `com.apple.security.automation.apple-events` plus a consent prompt under the hardened runtime notarization requires. Gating on env vars rather than forking the file is deliberate: a second code path is a second Unframed, and every feature would have to be built twice. Design in `docs/superpowers/specs/2026-08-13-native-app-design.md`.
- **The active project has to move in three places at once**, which is why `activate()` in `App.jsx` is the only thing allowed to change it: React state (what the toolbar shows), `setProject()` in `api.js` (the `currentProject` every generation is written under), and a `localStorage` stamp (where the next load lands). They used to drift, and the failure was silent and expensive — generations written into a project you were not looking at. Two related guards: the async initial load bails if `activated.current` is already set, so a switch made while it is in flight is not clobbered; and `listProjects()` returns `null` (not `[]`) when the request fails, because falling back to a "default" project on a failed load is what invented a phantom project and wrote into it.
- **Server is one file plus three modules** — `server/index.js` holds the routes; `env.js`, `share.js` and `presets.js` hold the three things whose rules are load-bearing enough to want tests. `index.js`: health, models, key, project CRUD, `/api/generate`, `/api/text`, `/api/video` — plus extensive error branching around the OpenRouter call, and filename slugify. It long had no test of its own, because it calls `app.listen` and reads the real `.env` at import, so a test would have run against your actual output dir. `UNFRAMED_DATA_DIR` and `PORT=0` are exactly what removed both objections, so `host.test.js` now forks the real thing into a temp dir on an ephemeral port and asserts the hosting contract. Anything needing only a request and a response can go there; nothing that spends money should.
- **Every run leaves a sidecar.** Generations and text runs both write `<timestamp>-<slug>.<ext>` plus a `<timestamp>-*.json` (prompt, params, cost) to `OUTPUT_DIR`; batch runs share a `batchId` with `runIndex`/`runCount`, so a batch's spend is a sum over one field.
- **The folder picker runs on the server.** A browser can't hand back a real filesystem path, so `POST /api/pick-folder` spawns the OS dialog itself — `osascript` / PowerShell `FolderBrowserDialog` / `zenity`, same per-platform shape as `/api/reveal`. `null` from the spawn means no picker exists here (501, "type the path instead"); `''` means the user cancelled, which is not an error.
- **One toast, once a day.** `App.jsx` nudges you to `git pull && npm run install:all`, keyed on a `localStorage` date stamp (`unframed:update-nudge`) rather than a boolean, so it returns tomorrow instead of never. It is a reminder, not a version check — no `git fetch` behind it.

## Node types

In `client/src/nodes/`, two families. Inputs only feed edges; outputs consume them — the engine's one rule, made visible by `NodeHeader`'s `family` prop.

| Family | Type id | Title on canvas | What it is |
| --- | --- | --- | --- |
| input | `prompt` | prompt | labelled free text |
| input | `image` | image | a picture you supply; connected ones are numbered so prompts can say "image 1" |
| input | `video` | video | a clip you supply, same numbering, counted among videos only; 25MB cap |
| output | `imageOutput` | image | generates an image |
| output | `videoOutput` | video | generates a clip; see `docs/video-and-sharing.md` |
| output | `textOutput` | text | runs a prompt through a text model, answer in `data.result` |

**Labels no longer match type ids, and that is the rule.** Output ids end in `Output` so they cannot collide with the `image` and `video` INPUT nodes; on the canvas they are titled by their medium via `NodeHeader`'s `title` prop, which defaults to `kind` for every other node. So "Image" appears under both Inputs and Outputs in the add menu on purpose: one is a picture you supply, one is a picture you generate, and the section header, the accent colour, the handle side and wildly different bodies all say which. The three were one `output` node with an Image/Video tab until 2026-08-13; `data.kind` is gone, and the medium is now the node's identity rather than a setting inside it. There is deliberately no way to convert one into another — delete and re-add.

Registered in `App.jsx`'s `nodeTypes`, which also holds `NEW_NODE`, the starting data per type shared by the add menu and the keyboard shortcuts. `App.jsx` also holds the starter graph, whose scene prompt embeds the subject prompt by `@id`. Its ids come from the same counter as user-added nodes, so nothing in a fresh graph carries a hand-written id.

**The three outputs sit on one shared core** (`client/src/nodes/output/`), split logic-vs-JSX because six small files would cost more to navigate than the duplication they removed. `core.js` holds `useModels(kind)` (catalogue + server default, with the unmount guard), `useModelParams(entry, kind)` (the whole `enumOf` derivation, including that an exact `size` REPLACES resolution + ratio), `freeSpot()` (canvas placement) and the `ratioLabel`/`capabilityTags` helpers; `controls.jsx` holds `<ModelPicker>`, `<ParamControls>` and `<CostFoot>`. Extracting this BEFORE splitting was the point — three node files copying what two already copied is the failure mode.

The video output node polls `/api/video/:id` and plays the result from `/api/file/...` rather than carrying bytes in node data, since a clip inlined into the graph would be rewritten to `graph.json` on every edit. **Add to canvas** is the one place that does inline it, on demand, because a reference must travel to OpenRouter and nothing there can reach this machine.
