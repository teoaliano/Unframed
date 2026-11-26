# Repository analysis

Used by the Repository analysis spec ("Agent tools"). The tool sections describe the agent's tools for the Code map, the Design-system index, the States index, mock files, placing Screens, frozen states and the take-home patch, with their arguments. The instruction is what "Show states" sends into a thread started from a Screen when its route has no prepared states: `<shape>` is the Screen's id, `<route>` its route, `<branch>` the Instance's branch, `<worktree>` the absolute path of its worktree and `<cases>` how many cases the States index lists for the route.

## repo_analyse

```text
Analyse an Instance's code and write the Code map, the Design-system index and the States index under .unframed/analysis/ in its worktree, excluded from git. It finds the stack and the routes from the router config or file-system routing, dialogs, flags, the app's components with their props, variants and how often they are used, its design tokens, and for each route the visible cases in its import closure (loading, error, empty, role, status, auth, dialog, first run). Running it again keeps what you added to the Code map (features, notes, a route's example, name and group) and every route's prepared states. It answers the stack, the routes and the counts. Run it after the app runs, and again after the code changes a lot.
```

- `shapeId`: A Screen whose Instance to analyse. Omit for the Repository's first Instance.

## code_map_read

```text
Read the Code map of an Instance: the stack, the routes (path pattern, file and line, params, layouts, group, name and the example a dynamic route is placed with), dialogs, flags, and the features and notes you added. It runs the analysis first when there is none. Add judgement by editing .unframed/analysis/code-map.json with your own file tools: features ({"name", "files", "routes"}), notes, and for each dynamic route an "example" path with real values, such as /posts/1, so Unframed can place a Screen for it.
```

- `shapeId`: A Screen whose Instance to read. Omit for the Repository's first Instance.
- `section`: One of stack, routes, dialogs, flags, features or notes. Omit for all of it.

## design_search

```text
Search the app's own design system before you build any UI: components with their file and line, props, variants and how many times the app uses them, and design tokens (CSS variables and Tailwind theme values) with their files. Reuse what it finds instead of writing new components or literal colours.
```

- `shapeId`: A Screen whose Instance to search. Omit for the Repository's first Instance.
- `query`: Words to look for, such as "button destructive" or "primary color".
- `kind`: component or token. Omit for both.
- `limit`: How many of each to answer, 20 when omitted.

## route_states

```text
List the states of a route: the cases the States index found in its import closure, each with its kind, file and line, the line's text and what its condition reads, and the states already prepared for it. Use the cases to decide which states to prepare with states_place, and the reads to see whether a mock, a Switch or steps reach each one.
```

- `shapeId`: A Screen whose Instance and route to use.
- `route`: The route, such as /posts/1 or /posts/:id. Omit for the Screen's route.

## mocks_read

```text
Read an Instance's mock files: each file under .unframed/mocks/ with its request handlers (method and URL pattern), WebSocket handlers, Collections and Switches, any module replacements, and the latest requests the app made in its Screens, each with its method, URL, status, the mock that answered it or none, and the line of app code that made it. Use the requests with no mock to find what still reaches a real backend.
```

- `shapeId`: A Screen whose Instance to read. Omit for the Repository's first Instance.

## mock_write

```text
Write one mock file, so the app behaves as if it had its backend. A file named like items.mock.js holds JavaScript that calls unframed.mock(({ http, ws, data, switches, reply }) => { … }) and runs in the page before the app's first module. http.get, post, put, patch, delete and any take a URL pattern (/api/items/:id for the page's own origin, a full URL or */path for others; * matches anything) and a handler that gets { params, query, body, method, url, headers } and returns a value sent as JSON, reply({ status, body, headers, delay }), reply.fail() for a network error, reply.pass() to let the request through, or a promise of one. data(name, rows) gives a Collection with all(), get(id), where(fields), insert(row), update(id, patch) and remove(id): writes last for the life of the page, so a list grows when the app adds to it. switches(name, options) answers the option the Screen's route picks with __unframed_switch=name:option, else the first. ws(pattern, handler) answers a WebSocket with { send, close, onMessage }. A file under modules/, such as modules/src/rpc/client.js, replaces the module the dev server serves at /src/rpc/client.ts when it serves source modules by path, as Vite does; import the real one from "/src/rpc/client.ts?unframed_real". Pages reload or swap in the new mocks when a file changes. The file is excluded from git, copied into every worktree and kept as one of Setup's files. Never mock by editing a tracked file.
```

- `shapeId`: A Screen whose Instance to write in. Omit for the Repository's first Instance.
- `file`: The file's path under .unframed/mocks/, such as items.mock.js or modules/src/rpc/client.js.
- `content`: The whole file.

## screens_place

```text
Place Screens for routes on the canvas, grouped by section in labelled frames, at the named Screen's viewport, beside what is there. Routes come from the Code map; a dynamic route is placed only with an example, from the Code map or given here as a path. Routes an Instance already shows on a plain Screen are skipped. At most twenty-four Screens are placed in one call, and the person can undo them in one step.
```

- `shapeId`: A Screen whose Instance and viewport to use. Omit for the Repository's first Instance at the default viewport.
- `routes`: Paths to place, such as ["/", "/posts/1"]. Omit for every route of the Code map.

## states_place

```text
Prove states of a Screen's route and lay them out as sibling Screens in a frame named after the route, below the Screen, and save them as the route's prepared states so "Show states" can place them again. Each state is a route, steps and mocks, as screen_state takes them, a few plain words for the state, and the case it shows. A state that cannot be reached by URL is reached by steps, a mock or a Switch on the route (?__unframed_switch=name:option), never by editing tracked code. Unframed proves every state headlessly first; when any fails, nothing is placed or saved and the answer names it.
```

- `shapeId`: The Screen whose route the states belong to; they take its Instance and viewport.
- `states`: The states. Each is {"route"?: "/items", "steps"?: […], "mocks"?: […], "state": "an empty list", "case"?: "src/Items.tsx:12 empty"}.

## state_freeze

```text
Freeze the state a Screen shows, so it reloads exactly: Unframed loads it headlessly with its steps and mocks, then saves its location, local and session storage, its mock Collections and the text typed into its fields under a content id. The Screen's route becomes that location with __unframed_restore=<id>, which restores all of it before the app boots, and its steps become the ones you keep: momentary UI such as an open dialog still needs the step that opens it. Storage is shared by every Screen of the Instance, so a restored key is seen by its other Screens too. It answers with a picture of the restored Screen.
```

- `shapeId`: The Screen to freeze.
- `keep`: The numbers of the Screen's steps to replay after the restore, counting from 1. Omit to keep none.

## instance_patch

```text
Export an Instance's changes as one patch against the commit its branch started from: committed, staged, unstaged and new files, with Setup's files, .unframed/ and git-ignored files left out. git apply on that commit reproduces the Instance's code. It answers the base commit, the files and the patch.
```

- `id`: The Instance's id.

## Show states

```text
Show the states of the Screen <shape>, at <route> on the branch "<branch>" (its worktree is <worktree>). The States index lists <cases> cases for this route: read them with route_states, decide which ones a person would want to see, and reach each with steps, a mock or a Switch, using mocks_read and the preview tools to check what the page requests. Then call states_place once with all of them. Change no tracked code; when a state truly needs a code change, say so instead.
```
