# Unframed: spec index

Read this file before any spec. It holds what every spec shares: the product in one page, the stack, the vocabulary, the three test seams, the contracts nothing may break, and the build order. Each numbered spec below is one `/implement` run. Build them in order. A spec may rely on everything an earlier spec delivered, and on nothing a later one delivers.

## The product

Unframed is a local, pay-per-generation image, video and text generator on an infinite canvas. You put material on the canvas (text, images, clips, drawings), select some of it, and either **Generate** (one paid model call through OpenRouter) or hand it to the **Agent** (a local coding agent, Claude or Codex, running on your own subscription). Results land back on the canvas as ordinary shapes you can select into the next run. Every run writes its output file and a JSON sidecar into the project folder. Nothing is hosted: the engine runs on your machine, binds loopback only, and holds your OpenRouter key.

The canvas is tldraw. There are no wires and no output nodes: **the selection is the input set**. A named group is a selection you keep, and it can carry standing generation settings (a recipe). The agent can also write HTML pages and HyperFrames motion compositions onto the canvas, tuned with DialKit parameters in a panel beside them or in a full-screen editor.

This is a rewrite of an existing app. Every capability the old app had is kept. The specs describe behaviour and file formats. They never describe the old code, and the old code is not available to you. Do not look for it.

## Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript everywhere, strict |
| Monorepo | pnpm workspaces, Node 24 |
| Server | Effect (Schema, RPC over one WebSocket, SQL on SQLite, Layers) |
| Shared contracts | one package of Effect Schemas used by server and web |
| Canvas | tldraw SDK, with tldraw sync (a sync room per project, served by the engine) |
| UI | React, Base UI, Tailwind, with t3code's UI kit and its default light and dark tokens (spec 12) |
| Chat composer | Tiptap, following t3code's composer (MIT) |
| Agents | Claude through the Claude Agent SDK, Codex through `codex app-server`, both behind t3code's provider adapter pattern |
| Tests | Vitest, Playwright |
| Motion | HyperFrames (`@hyperframes/core`, `player`, `producer`), GSAP |
| Parameters | DialKit |

t3code (github.com/pingdotgg/t3code, MIT) is the reference implementation for the agent runtime, the chat composer, the event store and the RPC transport. Where a spec says "as t3code does", open t3code and follow it. Credit it in the third-party notices.

## Package shape

- **engine**: the server process. One entry point that the desktop shell forks. It serves the web build, the RPC socket, the tldraw sync socket and a handful of plain HTTP routes on one origin.
- **web**: the React client.
- **contracts**: the Effect Schemas for every RPC method, event and persisted record.
- **domain**: pure modules with no I/O (request composition, `@id` resolution, pricing, dial config normalisation, job store rules, `.env` editing rules, permission policy). The engine and the web both import it.

The published engine is a flat bundle: an ESM `server/index.js` at the package root plus the built web client in `client/dist`. See spec 01.

## Vocabulary

Use these words, and only these, for these things.

- **Project**: a named folder under the output folder. It holds everything: the project database, every media file, every sidecar, every chat. Copying the folder copies the project.
- **Output folder**: the user-chosen root that holds all projects, plus `jobs.json` and `presets.json`.
- **Canvas**: the tldraw document of one project.
- **Shape**: anything on the canvas. The Unframed kinds are:
  - **prompt**: text. tldraw's text tool makes one. It has an `@id`.
  - **image**, **video**: media shapes naming a file in the project folder. tldraw's own image and video shapes, extended.
  - **group**: a named container. tldraw's frame, extended. Its name IS its `@id`.
  - **page**: an HTML artifact shown in a sandboxed frame.
  - **motion**: a HyperFrames composition shown in a player.
  - **mark**: every other tldraw drawing shape (draw, geo, arrow, line, highlight, note, and so on).
- **`@id`**: the reference token (`@` followed by word characters and hyphens) that pulls one prompt, text result or group into another prompt's text, or attaches one image or video to a run. Every shape but a mark has one: a number the canvas mints, or a name a person gives it (spec 06).
- **Selection**: the shapes currently selected. It is the input set of a run.
- **Run**: one Generate action. It may make several outputs (a **batch**).
- **Recipe**: everything needed to repeat a run: the sources, the model, the parameters, the per-run instruction. Every result carries one. A group can also carry one as standing settings (medium, model, parameters, runs), which holds no instruction and no sources: its sources are its members. Spec 03 defines both.
- **Result**: a shape a run produced. It is an ordinary image, video or prompt shape plus its recipe.
- **Sidecar**: the `.json` file written next to every generated, uploaded, rendered or agent-written file.
- **Composer**: the one input component. It has a **Generate tray** and an **Agent tray**.
- **Chat**: one conversation with the agent. It is made of **turns**. A chat has **tags**: the artifacts it has touched.
- **Artifact**: a page or a motion.
- **Editor**: the full-screen view of one artifact: chat on the left, the artifact in the centre, **dials** (DialKit parameters) on the right.
- **Render job**: a durable record of a paid video generation that outlives the browser tab.
- **Preview origin**: the second loopback HTTP server that serves artifact files and nothing else, on a fixed port (18787) unless something else holds it.
- **Live viewer**: the small page "Open in a new tab" opens. It shows a page or motion's newest version with its current dials, and follows both while the app is open (spec 09).
- **Share link**: a temporary public URL that serves one local file so a video model can fetch it.
- **Sketch**: marks rendered to an image at run time, either composited onto the image they sit on or, when loose, as a standalone reference image.
- **Placeholder**: the shape the engine puts on the canvas where a result will land, before the work that makes it is answered, carrying a run marker until the engine fills it (spec 03 defines it; specs 04, 05 and 09 use it).
- **Project database**: the one SQLite file in each project folder, `unframed.sqlite`, opened only by spec 01's project database module. Every spec that stores per-project records adds its tables to it.
- **Cache folder**: `.cache/` inside a project folder, holding regenerable files only (image previews, artifact snapshots). Deleting it loses nothing; nothing in it gets a sidecar or goes to a model.
- **Preferences store**: the engine-side store of per-person UI preferences, `preferences.json` in the data folder (spec 01). What the app "remembers" lives here, because the packaged app's origin changes on every launch and `localStorage` does not survive it.

## Test seams

There are exactly three. Every task in every spec names one of them.

1. **Engine seam.** The real engine process, forked by the test into a temporary data folder, on an OS-assigned port (`PORT=0`) with an OS-assigned preview port too (`UNFRAMED_PREVIEW_PORT=0`, so engines running side by side never compete for the fixed one), with every OpenRouter call (image, text, video, catalogue, pricing, key and auth endpoints) pointed at an in-test stub server through spec 01's single loopback-only `UNFRAMED_TEST_OPENROUTER_ORIGIN`, every other test hook set from spec 01's one table of test-only variables, and with the agent provider replaced by a scripted agent (a JSON script of turns, tool calls and failures, chosen by matching the first message). Tests drive it through its public interface only: the RPC socket, the sync socket, the plain HTTP routes, the IPC messages it sends its parent, and the files it writes. Nothing that spends money runs here.
2. **Domain seam.** The pure modules in `domain`, called directly. Use it for rules with many cases: request composition from a selection, `@id` resolution, numbering and roles, Free-mode splitting, pricing estimates, dial shorthand, job-store pruning, `.env` editing, permission decisions.
3. **Browser seam.** Playwright driving the built web client served by an engine running at the engine seam (stubbed upstreams, scripted agent). Use it for anything a person does on the canvas or in a dialog. Assert on what is on screen and on what the engine then holds.

A good test exercises behaviour through one of these interfaces and never reaches past it into internals. If a behaviour cannot be reached from any of the three, the design is wrong, not the seam list.

## Contracts no spec may break

These hold across every spec. A spec that needs to bend one must say so explicitly and why.

1. **Loopback only.** The engine binds `127.0.0.1`. Nothing is readable cross-origin (no CORS allowlist, not even for other loopback ports). A request carrying a non-loopback `Origin` is refused before any handler runs. A request whose `Host` is not loopback is refused (this is what stops DNS rebinding). The WebSocket upgrades, RPC and sync, get the same checks. The app speaks RPC over one WebSocket; the only plain HTTP routes are: the built web client (spec 01), project file serving `GET /api/file/<project>/<name>` (spec 01), media upload `POST /api/projects/<project>/files` (spec 02), the OAuth callback `GET /api/oauth/callback/<nonce>` (spec 10), the MCP endpoint for the local agents, behind a per-session bearer token (spec 07), the signed one-use attachment upload path (spec 07), the preview origin on its own loopback port (spec 09), and share links (spec 04). All of them keep these checks except one: the **share server** (spec 04), a separate loopback server that answers one route shape, `/share/<token>`, to a public hostname through a tunnel, so it applies no `Host` or `Origin` check. It is safe because nothing else exists on that server.
2. **The OpenRouter key never leaves the engine.** The web learns only whether a key exists and its last four characters.
3. **A page is never served from the app's origin.** Artifact HTML is served only by the preview origin (spec 09).
4. **Every paid run leaves a sidecar** with its cost. Batch members share a `batchId`. An agent turn's sidecar says `billing: "subscription"` and has no `cost` field at all, because a zero would corrupt a spend sum.
5. **A paid render is never stranded.** A render job is written as pending before the run is acknowledged, and any lifecycle change that could orphan it (changing the output folder, renaming or deleting a project, removing the key) resolves it visibly first (specs 04 and 10).
6. **One code path, standalone or hosted.** Hosted behaviour is switched on only by environment variables that are unset in a plain clone (spec 01).
7. **The tldraw watermark stays visible.** The license key comes from a build-time environment variable. Never hide or cover the watermark.
8. **Project folders are self-contained.** No project state lives outside its folder, except agent attachments (which live under the data folder), per-person preferences (the preferences store, also in the data folder) and the two output-folder stores.
9. **The canvas thread belongs to the canvas.** Nothing a person or the agent puts on the canvas may run on the thread that pans and zooms it. Artifact documents load from the preview origin under the other loopback name, so they run in their own process, and only selected, pinned or edited artifacts run at all; the rest show snapshots (spec 09). Images display from previews and send originals (spec 02). Every performance budget is measured in the hosted shape, the way the desktop shell loads the app, never only in the dev setup. The old app broke this and panned a ten-page board at 15 frames per second in the desktop app while the dev setup looked fine.

## Build order

| # | Spec | Delivers |
| --- | --- | --- |
| 01 | [Engine foundation](01-engine-foundation.md) | monorepo, engine process, hosting contract, loopback guards, the error shape, `.env` settings, the test-only variables, projects, the project database, the open-project registry, the preferences store, file serving, RPC skeleton, published bundle |
| 02 | [Canvas](02-canvas.md) | tldraw canvas per project, sync room and canvas change log, the shape kinds and asset markers, chrome with the shell's DOM hooks, the connection-lost notice, clipboard, drop and paste, menus, shortcuts, undo, theme |
| 03 | [Image generation](03-image-generation.md) | Generate composer, selection to request, model catalogue and dialog, parameters, pricing, placeholders and run markers, the recipe schema, results with recipes, sketches |
| 04 | [Video generation](04-video-generation.md) | video tray, input modes, durable render jobs and the sweep, share links |
| 05 | [Text, multi-run and Free](05-text-multirun-free.md) | text runs, `@id` results, batches, Free mode and its preview |
| 06 | [Groups, recipes and the library](06-groups-recipes-library.md) | named groups, rename, recipe groups, the library and presets |
| 07 | [Agent runtime](07-agent-runtime.md) | providers, adapters, chat event store, the MCP server with the two canvas tools, permissions, attachments, turn revert, scripted agent |
| 08 | [Agent chat](08-agent-chat.md) | the chat rail, tags, the Agent tray, work log, approvals, plan mode, queueing, search, diffs |
| 09 | [Artifacts](09-artifacts.md) | pages, motion, the preview origin, rendering, dials, the editor, the four artifact tools, and last the agent's preview tools |
| 10 | [Settings and OpenRouter](10-settings-openrouter.md) | settings dialog, OAuth key flow, key status, output folder moves, project rename and delete |
| 11 | [Legacy import](11-legacy-import.md) | one-time import of old projects and presets |
| 12 | [Design system](12-design-system.md) | t3code's tokens and UI kit on every surface, tldraw's UI themed to match, the lint that keeps it |
| 13 | [Design-system catalogue](13-design-system-catalogue.md) | a dev-only page showing every token, kit component and recipe, its API from the source, and where the product uses it |
| 14 | [External agents](14-external-agents.md) | agents outside the app (Claude Code, Codex, the Claude app, any MCP client) read and write the canvas over MCP: connection tokens made in Settings, a stdio shim that finds the engine through a discovery file, one outside chat per session per project with turns and Revert |
| 15 | [Audio](15-audio.md) | the audio medium (ElevenLabs text to speech) in the Generate composer, the ElevenLabs key and credits in Settings, the audio shape with its player, audio file drop and upload |

## Reference material in this repo

- `assets/brand/`: logo and favicon.
- `assets/theme/`: the old app's colour and chrome values. History only: spec 12 replaced them with t3code's tokens, so they are not the visual reference.
- `assets/prompts/`: model-facing text to use verbatim (agent system prompt, tool descriptions, repair prompts, starter content, bundled presets).
- `assets/design/`: the design canvas for selection-based generation. Open the `.dc.html` files in a browser.
- `assets/screenshots/`: the old app. History only since spec 12, not the visual reference.
- `assets/legacy-samples/`: old-format project and preset files for spec 11.
- `assets/fixtures/`: scripted-agent scenarios the old app tested against.
