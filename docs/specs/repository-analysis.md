# Repository analysis

Builds on `docs/specs/repositories.md` and `docs/specs/screen-states-and-branches.md`. Glossary: `CONTEXT.md` (Repository, Instance, Setup, Screen, Steps, Mocks, Flow, Mock files, Code map, Design-system index, States index, Frozen state).

## Problem

A Repository today shows one Screen at `/` once Setup makes the app run. Everything after that is manual or agent guesswork:

- Nobody knows the app's routes. The person navigates to find them, and the agent reads the code from scratch in every thread.
- An app with a backend shows nothing useful without it. A Screen's Mocks answer one request each with a fixed body, so a list that grows when you add an item, a login that remembers the user, or a whole API cannot be faked.
- A screen's states (empty, error, loading, a role, a dialog) are spread through its components. Finding them means reading the route's import tree by hand.
- The agent has no index of the app's own components and tokens, so it recreates UI that already exists.
- A state reached by typing or by data written along the way does not reload the same way twice.
- Changes made in an Instance leave only by commit and push. There is no patch to hand to someone.

## Solution

- **Analysis.** The engine reads the worktree and writes three files under `.unframed/analysis/`, all excluded from git: a **Code map** (stack, routes, dialogs, flags, features), a **Design-system index** (components with file:line, props, variants and usage counts; tokens with their files) and a **States index** (per route, the visible cases found in its import closure). Route discovery, component and token extraction, usage counts and case finding are deterministic engine code. The agent adds judgement on top: features, notes, example values for dynamic routes, and prepared states.
- **Mock files.** Setup writes the app's fake backend as JavaScript files under `.unframed/mocks/`. The bridge script loads them before the app's first module runs. They answer `fetch`, `XMLHttpRequest` and `WebSocket` by URL pattern, keep **Collections** of rows that handlers read and write, and offer **Switches** that a Screen's route can set. Edits hot-reload. Every request the page makes is logged with the mock that answered it and the line of app code that made it.
- **Routes on the canvas.** When the person confirms Setup with "Looks right", Unframed places one Screen per route of the Code map, grouped and labelled, beside the first Screen.
- **Show states.** A Screen's toolbar gets "Show states". It lays out the route's prepared states as sibling Screens. When the route has none yet, it asks the agent to prepare them.
- **Frozen states.** The agent can freeze a Screen: its URL, its storage, its Collections and the values typed into its fields are saved under a content id. The Screen's route then carries `__unframed_restore=<id>`, and the bridge restores everything before the app boots.
- **Take-home.** An Instance's changes export as one patch against its base commit, with Unframed's excluded files left out.

## User Stories

1. As a person who just confirmed Setup, I want every page of my app placed on the canvas, grouped by section and labelled, so that I see the whole app without navigating.
2. As a person, I want dynamic pages such as `/posts/:id` shown with a real example id, so that they show content instead of a 404.
3. As a person, I want routes that need a value nobody gave left off the canvas, so that I never see a broken Screen placed for me.
4. As a person, I want "Show states" on a Screen to lay out that page's empty, error, loading and other states beside it, so that I can review every case at once.
5. As a person, I want "Show states" to ask the agent when the page has no prepared states, so that one click starts the work.
6. As a person, I want my app to behave as if it had a backend when Setup mocked it, so that adding an item adds it, and opening it shows it.
7. As a person, I want the data a Screen writes to stay in that Screen, so that playing with one Screen never changes another.
8. As a person, I want a Screen that holds a frozen state to reload exactly, with the text I typed and the data I added, so that a state is the same every time I see it.
9. As a person, I want mocks never to change tracked files, so that my repository stays clean.
10. As a person, I want a patch of an Instance's changes that leaves Unframed's files out, so that I can apply it anywhere with `git apply`.
11. As the agent, I want a Code map, a searchable design system and a states list per route, so that I reuse the app's own components and reach states without reading the whole repository.
12. As the agent, I want to see which requests the page made, which mock answered each and which line made it, so that I mock the right boundary.
13. As the agent, I want to place Screens for routes and for states in one call each, proven first, so that the canvas only gets states that work.
14. As an outside agent, I want the same analysis and mock tools, so that I can work on a Repository from my own editor.
15. As a person with the flag off, I want none of this offered, while Screens placed before still open read-only.

## Implementation Decisions

### Analysis

- The engine lists the worktree's files with `git ls-files --cached --others --exclude-standard`, keeps source, style, config and `package.json` files (at most 5000 files, 256 KB each), and passes them to pure domain functions in `packages/domain/src/repoAnalysis/`.
- **Route discovery** covers Next (app and pages routers), React Router and Vue Router configs (`path:` objects and `<Route path>` JSX with nesting), TanStack file routes, flat `app/routes` files, SvelteKit, Nuxt, Astro, and a plain single-page app with no router (one route at `/`). Each route has a path pattern (`:id`, `:slug*`), its file and line, its layouts, a group (first static segment) and a name.
- **Design-system index**: exported PascalCase components with props from their props type or destructured parameter, `cva` variants, the number of JSX uses in other files and the files that use them most. Tokens: CSS custom properties (including Tailwind v4 `@theme`) and Tailwind v3 theme keys, each with file and line.
- **States index**: for each route, the import closure of its file and layouts (relative imports, `tsconfig` path aliases, lazy imports), then each line that shows a case: loading, error, empty, role, status, auth, dialog, first run. A case names its file, line, the line's text and what the condition reads.
- The files are `.unframed/analysis/code-map.json`, `design-system.json` and `states.json`, merged into `.git/info/exclude`. Running analysis again keeps what the agent added: features, notes, a route's example, name and group, and each route's prepared states.
- The agent edits the Code map's judgement fields with its own file tools. Prepared states are written only by `states_place`, which proves them first.

### Mock files

- A mock file is `.unframed/mocks/<name>.mock.js`. It calls `unframed.mock(({ http, ws, data, switches, reply }) => { … })`:
  - `http.get|post|put|patch|delete|any(pattern, handler)`. A pattern is a path (`/api/items/:id`, `*` for any run of characters) matched against same-origin paths, or a full URL for other origins. The handler gets `{ params, query, body, method, url, headers }` and returns a value (sent as JSON with status 200), `reply({ status, body, headers, delay })`, `reply.fail()` for a network error, `reply.pass()` to let the request through, or a promise of one of these. `undefined` answers 204.
  - `data(name, rows)` returns a Collection: `all()`, `get(id)`, `where(fields or predicate)`, `insert(row)`, `update(id, patch)`, `remove(id)`. Rows have an `id`; `insert` gives one when missing.
  - `switches(name, options)` returns the option the Screen's route selects with `__unframed_switch=<name>:<option>`, else the first.
  - `ws(pattern, handler)` answers `new WebSocket(url)` with a fake socket: the handler gets `{ send, close, onMessage }`.
- The engine loads every `*.mock.js` file in the folder, sorted by name, and the proxy appends them, with the mock runtime, to `/__unframed/bridge.js`, after the restore payload and before the existing bridge. A Screen's own Mocks are checked first, then the mock files, then the network.
- Collections live in the page. Writes last until the page reloads, which keeps each Screen apart. A frozen state saves them.
- **Hot reload.** The engine watches the folder. The bridge listens on `/__unframed/mocks/events` (server-sent events). On a change it fetches `/__unframed/mocks.js`, replaces the handlers in place and reseeds only the Collections whose seed rows changed. A Screen with no Steps, Mocks or frozen state then reloads, so it shows the new answers.
- **Request log.** Each `fetch`, `XMLHttpRequest` and `WebSocket` the page opens is logged with its method, URL, status, the mock that answered (`file: METHOD pattern`) or none, and the call site, the first stack frame outside the bridge, as `path:line:column`. The bridge posts the log to `/__unframed/mocks/log`. The engine keeps the last 200 entries per Instance.
- **Module replacement.** A file `.unframed/mocks/modules/<path>.js` replaces the module the dev server serves at `/<path>` with any source extension, for dev servers that serve source modules by path (Vite). Requests with `?unframed_real` get the real module, so a replacement can wrap it. Bundling dev servers (Next, webpack) are out of scope for this.
- Mock files are Setup files: Setup lists them in `setup_save`, and `mock_write` adds a file to the Repository's Setup files, copies it into every worktree and excludes it.

### Frozen states

- `state_freeze` loads a Screen in headless Chrome with its state, replays its Steps, and reads the bridge's freeze: location, `localStorage`, `sessionStorage`, every Collection's rows and the values of text fields that differ from their defaults (by a CSS path).
- The payload is stored as `<project folder>/states/<id>.json`, where the id is `s_` plus the first 32 hex characters of its SHA-256. The Screen's route becomes the frozen location with `__unframed_restore=<id>`, and its Steps become the ones the agent asks to keep (none by default; a click that opens a dialog, for example).
- On a document request carrying `__unframed_restore`, the proxy drops the parameter on the way upstream and adds `restore=<id>` to the bridge tag. The bridge script then starts with the payload. Before the app runs, the runtime writes storage and Collections. After the page paints and its Steps finish, it fills the fields again.
- The parameter stays in the page's own URL, so the Screen's route matches the page and reloads keep the state. Navigating away is ordinary navigation: the Screen follows and drops the state.
- The freeze is proven: the tool loads the new route and answers with its picture.

### Routes and states on the canvas

- `screens_place` (tool) and "Looks right" (Setup) place Screens for routes: one tldraw frame per group, named after it, holding one Screen per route at the first Screen's size and titled with the route's name. Routes already shown by a plain Screen of that Instance are skipped. A dynamic route is placed only with an example. At most 24 Screens are placed in one call.
- `states_place` proves each state like `flow_create`, saves the recipes as the route's prepared states, and lays them out as sibling Screens in a frame named "<route> states", below the source Screen's frame or the Screen itself.
- "Show states" calls `screens.showStates`. With prepared states, the engine places them as `states_place` does, without proving again. With none, the web sends the agent the "show states" instruction (model-facing text in `assets/prompts/repository-analysis.md`) naming the Screen, its route and how many cases the States index found.

### Agent tools

All are `repository` scoped and registered only with the flag on. The ones marked "outside" are also offered to outside agents on a Repository project. A tool with no Screen uses the Instance of the Screen in the call, else the Repository's oldest Instance that is not removed.

| Tool | Does | Outside |
|---|---|---|
| `repo_analyse` | Runs analysis on an Instance and answers counts and the routes | yes |
| `code_map_read` | Answers the Code map, or one section | yes |
| `design_search` | Searches the Design-system index | yes |
| `route_states` | Answers a route's cases and prepared states | yes |
| `mocks_read` | Answers the mock files, their handlers, Collections and Switches, and the recent request log | yes |
| `mock_write` | Writes one mock file and shares it as a Setup file | yes |
| `screens_place` | Places Screens for routes | yes |
| `states_place` | Proves, saves and places states for a Screen's route | no |
| `state_freeze` | Freezes a Screen's state | no |
| `instance_patch` | Answers an Instance's patch | yes |

### Take-home

- `instances.patch` and `instance_patch` answer `{ base, files, patch }`: committed, staged, unstaged and untracked changes against the merge-base with the base ref, built through a temporary index so the real index is untouched, with Setup's files, `.unframed/` and git-ignored files left out. `git apply` of the patch on the base commit reproduces the worktree's tracked files.
- The branch chip's Changes view gets "Export patch", which saves `<branch>.patch`.

### Delivery

- Everything is behind the `repositories` flag. Lands by PR into `feat/repositories`.
- No change to the desktop shell, the hosting contract, the Screen shape's props or the existing bridge code. The proxy grows the new paths and the restore parameter.

## Testing

- **Domain** (`packages/domain/test/repoAnalysis/`, `mockRuntime.test.ts`): route discovery per router family on in-memory trees, components, variants, usage counts and tokens, the import closure and state cases, `routeFor`, the merges, mock pattern matching, call-site parsing, the restore parameter and the route board layout.
- **Engine**: `repositoryAnalysis.test.ts` (analysis files written and excluded on a fixture repo, merges kept, tools answer), `mockFiles.test.ts` (mock files served with the bridge, a mocked list rendered in headless Chrome, a Collection insert visible to the next read, hot reload, the request log with call sites, a module replaced through the proxy), `frozenStates.test.ts` (freeze and restore of typed text and Collection rows), `instancePatch.test.ts` (the patch applies on the base and leaves excluded files out), `featureFlags.test.ts` (tools absent with the flag off).
- **Browser** (`repositoryAnalysis.spec.ts`): Screens placed for routes after "Looks right", Show states placing prepared states and asking the agent when there are none, a mocked request rendering in a Screen, Export patch; `featureFlags.spec.ts` for Show states hidden with the flag off.

## Out of scope

- Module replacement on bundling dev servers, and replacement inside node_modules.
- Restoring momentary UI that lives only in memory (an open menu, a toast) from a freeze. Steps kept on the frozen Screen reach them.
- Cookies in a freeze: logins stay shared across Screens as today.
- Compile-time element stamps mapping the DOM to source lines.
- Persisting a Screen's Collections across reloads without a freeze.
- Editing tracked files to make a state reachable. When a state needs it, the agent stops and asks.
