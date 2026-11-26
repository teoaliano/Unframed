# Repositories

Source: the wayfinder map "Repository projects" (`.scratch/repositories/map.md`, local, untracked) and its eleven tickets. Glossary: `CONTEXT.md` (Project, Whiteboard, Repository, Instance, Setup, Screen, Flow).

## Problem Statement

A person building a real web app wants to see and compare versions of it the way Unframed lets them compare images and pages: side by side on a canvas, annotated, handed to an agent. Today a project is a folder of files Unframed owns. Their app lives in a git repository and only exists as a running dev server in one browser tab, one branch at a time. Trying three directions means juggling branches, restarting servers and losing the comparison. When the app needs a login or a backend, even getting one screen to render is work.

## Solution

A second kind of project, the **Repository**, beside today's **Whiteboard**, which stays unchanged. The person adds an existing local git repository. Unframed creates the first **Instance**, which is a branch checked out in its own worktree and running its frontend. Unframed then starts **Setup**, an agent thread that works out what this repo needs to run and proves a **Screen** shows real content.

Each Screen on the canvas is one route of one Instance at one viewport. It's live while visible and a snapshot otherwise, served through an Unframed proxy so logins, Parameters and comments work. Forking a Screen creates a new Instance. Exploding a head into a **Flow** lays out its routes. Agent threads can fork several Instances and work across them. Git actions (commit, push, PR, diff) come from t3code's model. All of it sits behind the `repositories` feature flag, on a long-lived branch, built as the dev app for real-world testing before anything reaches `main`.

## User Stories

### Adding a Repository

1. As a person with the flag on, I want "Add Repository…" next to "New Whiteboard" in the new-project menu, so that I can bring my app onto the canvas.
2. As a person, I want "Add Repository…" to open a folder picker, so that I can choose the repo without typing a path.
3. As a person, I want a folder that isn't in a git repo refused with one plain line, so that I know why nothing happened.
4. As a person, I want a subfolder of a repo to resolve to the repo root, so that I can't add half a repo by mistake.
5. As a person, I want the project named after the repo folder by default, so that I recognise it in the project list.
6. As a person, I want Repositories listed beside Whiteboards, with their kind visible, so that I can tell them apart.
7. As a person, I want my repo never written to by Unframed's own bookkeeping, so that adding it has no side effects on my code. The canvas lives in Unframed's output directory with the repo path recorded.
8. As a person whose repo moved, I want the Repository to say "Repository not found" and let me locate it, so that my canvas survives the move.
9. As a person, I want the first Instance created in a fresh worktree from my currently checked-out branch, so that my main checkout and its work in progress are never touched.
10. As a person with uncommitted changes, I want one line saying they aren't carried into Instances, so that I'm not surprised when they're missing.
11. As a person, I want Setup to start right away in the Repository's chat, so that I don't have to figure out how to run my app inside Unframed.
12. As a person, I want the first Screen at `/` to show Setup's progress while it works, so that the canvas isn't empty and I can see what's happening.

### Setup

13. As a person, I want Setup to copy my git-ignored `.env*` files into each worktree first, so that the app has its keys and URLs without me copying anything.
14. As a person, I want Setup never to print the contents of my env files, so that secrets stay off the screen and out of logs.
15. As a person, I want Setup to find the setup and run commands from my repo (scripts, lockfile, `t3.json` if present), so that I don't have to configure anything.
16. As a person, I want Setup to save the setup command, run command, port mode, its own files, what it mocked and any warnings on the Repository, so that later Instances start without repeating Setup.
17. As a person whose app needs a login, I want Setup to first ask me to log in once in a Screen, so that real data works everywhere with no code change.
18. As a person whose repo has a dev bypass or seed user, I want Setup to use it through the environment, so that the app runs without changing code.
19. As a person, I want Setup to ask me before it mocks the logged-in user or API data, so that I decide whether fake data is acceptable.
20. As a person, I want everything Setup adds to be new files listed in `.git/info/exclude`, so that my `.gitignore`, branches and PRs never contain Setup's work.
21. As a person, I want Setup to stop and explain when it would need to edit a tracked file, so that no silent change reaches my code.
22. As a person, I want Setup's files copied into every new worktree before its run command, so that every Instance works the way the first did.
23. As a person, I want Setup to propose "done" with a snapshot and let me confirm with "Looks right", so that success means what I see, not what the agent thinks.
24. As a person who rejects Setup's result, I want my note to send Setup on, so that it keeps trying with my feedback.
25. As a person, I want to run Setup again from the Repository's menu, so that I can fix things after my app changes.
26. As a person viewing a Screen that uses mocks, I want a small visible tag (for example "mock user · fixtures"), so that nobody mistakes it for real data.
27. As a person, I want warnings such as an OAuth callback on `localhost:3000` recorded and shown, so that I know which flows need "Open in browser".

### Instances

28. As a person, I want to fork a Screen into a new Instance on a new branch from that Instance's HEAD, so that I can try a different direction side by side.
29. As a person, I want to name the new branch when forking, with a sensible default, so that my branches stay readable.
30. As a person, I want to create a new Instance from a base branch I pick (the current branch by default), so that I can compare against `main` or a colleague's branch.
31. As a person, I want worktrees kept under Unframed's data directory, so that my repo folder doesn't fill with checkouts.
32. As a person, I want the setup command run once per new worktree with progress on its Screens, so that a new Instance becomes usable without me running installs.
33. As a person, I want to remove an Instance, deleting its worktree and optionally its branch, so that I can clean up rejected directions.
34. As a person, I want a confirmation when the branch has commits that aren't pushed or merged, so that I never lose work by removing an Instance.
35. As a person, I want Screens of a removed Instance to stay as their last snapshot marked "Instance removed", so that comparisons and comments survive.

### Running and ports

36. As a person, I want each Instance started on its own port automatically, so that several versions run at once.
37. As a person, I want Unframed to check the port the server actually bound, so that a server that moved or failed to bind is reported, not shown as blank.
38. As a person whose app truly pins its port, I want the Repository marked "single port", with one Instance live and the rest as snapshots, so that it still works on the canvas.
39. As a person, I want an Instance to run only while one of its Screens is visible or selected, so that my Mac isn't running servers for nothing.
40. As a person, I want off-screen Screens to drop to their snapshot within seconds, so that the canvas stays fast.
41. As a person, I want a dev server stopped after 10 minutes with nothing visible and no file changes, so that memory is given back.
42. As a person, I want a memory budget (about 25% of RAM) that stops the least recently viewed Instance past it, so that many Instances never swap my machine.
43. As a person, I want the snapshot to stay up until the live page has painted, so that a Screen never flashes blank while its server starts.
44. As a person, I want visible Instances started first and the rest one at a time, so that what I'm looking at comes up fastest.
45. As a person, I want build caches kept when a server stops, so that it restarts in a second or two.
46. As a person, I want every dev server killed when Unframed quits, and leftovers swept on the next start, so that no orphan processes hold ports.
47. As a person launching Unframed from Finder, I want `git`, Node and my package manager found the way my terminal finds them, including nvm, volta and mise, so that my repo runs the same as in my shell.

### Screens and Flows

48. As a person, I want a Screen to show one route of one Instance at one viewport size, so that I can lay out exactly the views I care about.
49. As a person, I want to click through a Screen when it's selected, so that I can use the app on the canvas.
50. As a person, I want to change a Screen's route and viewport, so that I can show the same Instance at phone and desktop width.
51. As a person, I want to explode an Instance into a Flow of its routes, proposed by the agent from the router, so that I can see the whole app at once without a new worktree.
52. As a person, I want to type routes when the agent can't find them, so that screens behind state can still be added.
53. As a person, I want a Flow to be a group labelled with its Instance's branch, so that I can move and compare whole Flows.
54. As a person, I want to draw marks and pin comments on a Screen, so that I can give the agent visual feedback about a running version.
55. As a person, I want "Open in browser" on every Screen, so that flows tied to an exact origin, such as OAuth, still work.
56. As a person, I want to log in once and be logged in on every Screen of every Instance, so that comparing versions doesn't mean logging in N times.
57. As a person, I want Screens of a Repository to coexist with images, prompts, marks and comments, so that the canvas stays a full Unframed canvas.

### Parameters

58. As a person, I want the agent to expose Parameters in my app's components with the same `unframed.dials` contract pages use, so that I can tune values by hand on a Screen.
59. As a person, I want Parameter values kept per Screen, so that I can compare two settings of the same Instance side by side without forking.
60. As a person, I want Apply to ask the agent to write the values as defaults in that Screen's Instance worktree, uncommitted, so that a setting I like becomes code I can review.
61. As a person, I want `unframed.dials` calls guarded so that my app runs unchanged outside Unframed, so that nothing in production depends on Unframed.
62. As a person whose app blocks the injected script (strict CSP, a page that isn't HTML), I want the Screen to still run with comments and marks, and Parameters to explain in one line why they're unavailable, so that I understand the limit.

### Agent

63. As a person, I want threads created by me, as today, so that the agent never starts work I didn't ask for.
64. As a person, I want a thread started from a selection of Screens to work in that Instance's worktree, so that the agent edits the version I'm pointing at.
65. As a person, I want to ask one thread for "three variants", and have it fork three Instances and work in each, so that exploring directions is one request.
66. As a person, I want the agent to create, remove and inspect Instances (status, port, server log tail) with tools, so that it can run and debug the app itself.
67. As a person, I want the agent to click, type, evaluate and snapshot on Screens the way it does on pages, so that it can check its own work visually.
68. As a person, I want the agent told what an Instance is, where the worktrees are, to never commit unless asked, to leave Setup's files alone, and to guard `unframed.dials`, so that it behaves safely in my repo.

### Git

69. As a person, I want to see a diff of an Instance's changes against its base, so that I know what the agent did in that version.
70. As a person, I want commit, push, and open-PR actions on an Instance (chained like t3code, with generated messages), so that I can move a version I like toward review without leaving Unframed.
71. As a person, I want Setup's files excluded from every diff, commit and PR, so that only my real changes travel.
72. As a person, I want merging left to GitHub and my own git tools, so that Unframed never destroys work with a bad merge.

### Flag and safety

73. As a person with the flag off, I want "Add Repository…" hidden, existing Repositories listed and opened read-only on their last snapshots, and no Instance or Setup started, so that turning the flag off is safe.
74. As a person, I want code running inside an Instance unable to call Unframed's engine, so that a third-party script in my app can never spend my money or read my canvas.
75. As a person, I want Instance frames to have no permissions, popups or downloads, so that the running app can't escape the canvas.
76. As a tester, I want the whole feature built into "Unframed Dev" from the long-lived branch, so that I and others can use it for weeks on real repos before deciding whether it reaches `main`.

## Implementation Decisions

### Delivery

- The work lands on a long-lived branch, `feat/repositories`, cut from `main`. Pull requests target that branch, never `main` or `dev`. Testers build it with `pnpm dev:app`. Whether it ever reaches `main` is decided after real-world use.
- Everything is also gated by a new feature flag `repositories`: listed in `FEATURES`, with a refusal line in `FEATURE_OFF_MESSAGES`, gated with `useFeature` in the web app, `featureOn` in engine handlers, and `Features` in the agent tool catalogue. The dev app and test harnesses already turn on `all`.
- No change to the desktop shell or to the hosting contract (env var names, IPC, banner, DOM hooks, bundle layout).

### Projects

- A project gains a **kind**: `whiteboard` (every existing project, implied when absent) or `repository`. The kind and the repository record live in the project's own database, so nothing outside the project folder changes, and existing projects need no migration of their files.
- The **repository record** holds:
  - the repo root path and the canonical git common dir
  - the base branch at add time
  - the Setup result: setup command, run command, package manager, port mode (`free` or `single` with its fixed port), the list of Setup's files, mocks, warnings
  - a status: `ready`, `setting-up` or `missing`
- `projects.list` answers each project's name and kind. A new `repositories.add` takes a folder path, resolves the git root (refusing non-repos), creates the project folder in the output directory, writes the record and creates the first Instance. A new `repositories.pickFolder` reuses the engine's existing native folder picker.
- A Repository's project folder holds its canvas database and snapshots like a Whiteboard. It never holds a checkout.

### Instances (engine module, deep)

- One engine module owns Instances end to end. Its interface is small: `create`, `remove`, `list`, `status`, `demand` (the set of Instances the canvas wants live), and a stream of Instance states. Behind it sit git worktrees, file copying, process supervision, port allocation, the proxy, the budget and the idle timer.
- **Instance record**:
  - id, Repository, branch, base ref, worktree path
  - state: `creating`, `installing`, `starting`, `live`, `stopped`, `failed` or `removed`
  - the proxy port, the bound upstream port, the last error, the tail of the server log
- **Worktrees** live at `<data dir>/worktrees/<repository>/<branch-slug>-<short hash>`, created with `git worktree add -b <branch> <path> <base>`. Branch names: the person's, or a generated default (`unframed/<short id>`).
- On create, before the run command, the module:
  - copies the main checkout's git-ignored `.env*` files and Setup's listed files into the worktree
  - merges their entries into the repo's `.git/info/exclude`, which all worktrees share
  - runs the setup command once
- `remove` deletes the worktree, optionally deletes the branch, and refuses unless forced when the branch has commits not on its upstream or base. Screens keep the Instance id, and the web marks them "Instance removed".
- **Spawning**:
  - The run command executes in the worktree through the person's login-shell PATH, resolved once with `-ilc` by a shared service. The existing claude and codex detection moves onto that service.
  - The environment strips `ESBUILD_BINARY_PATH`, `ELECTRON_RUN_AS_NODE` and every hosting-contract variable.
  - Processes run in their own process group and are killed on engine shutdown. A pid file per Instance lets the next start sweep leftovers.
- **Ports**: the module picks a free upstream port and passes it as both `PORT=<n>` and the port flag, shaped for the package manager:
  - npm and bun: `-- --port <n>`
  - pnpm (v7+) and yarn: `--port <n>`
  - plus `--strictPort` for the Vite family

  It then verifies the bound port by probing the expected one and parsing stdout. A Repository in `single` mode always uses its fixed port and keeps at most one Instance live.
- **Budget**: the budget is about 25% of total RAM, measured by summing the RSS of each Instance's process tree. `demand` comes from the web (visible or selected Screens). When over budget, the least recently demanded Instance stops. An Instance with no demand and no file changes stops after 10 minutes. Starts are ordered: demanded first, one at a time. Build caches (`.next/`, `node_modules/.vite/`) are kept across stops.

### Proxy (inside the engine, one listener per live Instance)

- It listens on `127.0.0.1:<proxy port>`, same-site with the canvas (served from `127.0.0.1`), so the app's Lax cookies work in the iframe and every Instance of a Repository shares them.
- Requests go upstream to `127.0.0.1:<upstream>`, falling back to `[::1]:<upstream>`, because Vite listens only on `::1` by default on macOS. The browser's Host header is kept, except on upgrades (see Origin).
- **WebSocket upgrades** are forwarded on every path, with the query string intact.
- **Origin**: on upgrades and on `/_next*` and `/__nextjs*` requests, an Origin that names the proxy itself is rewritten to `http://localhost:<proxy port>`. Without this, Next refuses hot reload from `127.0.0.1`. On upgrades the Host becomes `localhost:<proxy port>` too, so an app that checks Origin against Host on its WebSocket (ComfyUI) accepts it. See `docs/specs/screen-load.md`.
- **Location** headers that name `localhost:<upstream>`, `127.0.0.1:<upstream>` or `[::1]:<upstream>` are rewritten to the proxy origin.
- **HTML responses**:
  - it asks upstream for identity encoding
  - it stream-injects `<script src="/__unframed/bridge.js"></script>` right after `<head>`, copying any CSP nonce onto the tag
  - it strips `X-Frame-Options` and `frame-ancestors`
- The bridge script is served by the proxy. It provides `window.unframed.dials`, wired to the canvas by postMessage like the page bridge, and reports readiness. When injection is impossible, the Screen reports "no bridge", and Parameters show one line saying why.
- The header and HTML rules are pure functions in the domain package. The listener is engine code.

### Origin check

- The engine's loopback guard accepts only the canvas's own origin, plus the existing preview origin where it already does. It no longer accepts any loopback origin. This ships before Instances can run.

### Screens (canvas shape)

- A new shape kind `screen` with props:
  - `instance` (Instance id), `route`, `w`, `h` (viewport), `title`
  - `dials` (Parameter values, per Screen), `mode`
- Like a page, it renders the live iframe when it's demanded and on screen, and its snapshot otherwise. The snapshot stays until the live frame reports its first paint.
- The iframe:
  - URL: `http://127.0.0.1:<proxy port><route>`
  - `sandbox`: allows scripts, same-origin, forms and modals; denies top navigation, popups to top and downloads
  - `allow=""`
  - pointer events only when selected, as pages work today
- Overlays on the Screen: setup progress, the mock tag, warnings, "Instance removed", and "Repository not found".
- Snapshots go through headless Chrome against the proxy URL, debounced, cached like page snapshots.
- A **Flow** is an ordinary tldraw group of Screens from one Instance, titled with the branch. Explode creates it with arrows in route order.
- Screen actions: Open in browser (the proxy URL), Fork into a new Instance, Change route, Change viewport, Remove Instance.

### Agent

- Tools gated on the flag:
  - `instance_create` (from a Screen or a base branch, optional branch name)
  - `instance_remove`
  - `instance_status` (state, ports, log tail)
- The existing `preview_*` tools accept Screens. `canvas_read` and `canvas_write` handle `screen` shapes. In a Repository, `page_write` and `motion_write` are not offered; the agent edits code with its own file tools.
- The **working Instance**: a thread started with Screens selected runs its provider with that Instance's worktree as cwd. A thread that forks Instances is given each new worktree path in the tool result and works across them with absolute paths.
- The system prompt gains a Repository section, model-facing text kept in `assets/prompts/`, covering:
  - what an Instance is and where the worktrees are
  - never commit unless asked
  - leave Setup's files alone
  - guard `unframed.dials` as `window.unframed?.dials(...)`
- **Setup** is a thread the engine opens when a Repository is added or Setup is re-run, with its own prompt in `assets/prompts/`. The prompt carries:
  - the goal: a Screen showing real content
  - `.env` copying as step zero (done by the engine)
  - the login ladder: real login once, then a switch the repo already has, then a mock after asking
  - new files only, under `.unframed/` plus framework-required files, listed in `.git/info/exclude`
  - stop and explain before editing a tracked file
  - record mocks for the Screen's tag
- Setup's tools:
  - `instance_status` and Instance start and stop
  - `screen_snapshot`
  - `ask_login`: highlights a Screen and waits for the person's confirmation
  - `setup_save`: writes the record and copies Setup's files into existing worktrees
- Setup proposes done. The person's "Looks right" closes Setup and marks the Repository `ready`; a rejection sends their note back as the next turn.

### Git actions

- These are ported from t3code's logic onto the engine's existing process layer, with no Effect modules lifted wholesale. They are:
  - an Instance diff (`git diff <merge-base>...` on the worktree, Setup's excluded files never shown)
  - stacked actions: commit, commit and push, commit, push and open PR
  - a generated commit message and PR title and body through the person's agent provider
  - PRs through the GitHub REST API with a token from `gh auth token` or env
- Merge, PR management and checkpoints are out of scope.

## Testing Decisions

- Good tests exercise behaviour through the module's interface as a caller sees it (RPC answers, files on disk, HTTP through the proxy, what the page shows), never internal structure.
- **Engine seam (Vitest, real engine)** carries most of the feature. A test helper builds a throwaway git repo whose `dev` script is a tiny fake dev server, a Node script that honours `PORT` and `--port`, prints its URL, serves HTML with a `<head>`, sets a Lax cookie on `/login`, redirects to `localhost:<port>`, and answers WebSocket upgrades. A fake login shell (the existing pattern for `claude` and `codex`) supplies PATH. The scripted agent (fixtures under `assets/fixtures/`) drives Setup and the Instance tools. Prior art: `agentFakes.ts`, `scriptedAgent.test.ts`, `pickFolder.test.ts`, `preview.test.ts`, `projects.test.ts`, `processLifetime.test.ts`, `featureFlags.test.ts`.
- **Domain seam (Vitest, pure logic)**: run-command shaping per package manager and framework, budget eviction choice, idle-stop decision, HTML injection over chunked input (including a split `<head>`), header rewrite rules, exclude-file merge, worktree path naming. Prior art: the domain tests of `loopbackGuard`, `devShare` and artifact rules.
- **Browser seam (Playwright against the running app)**:
  - the new-project menu with and without the flag
  - adding a Repository (with the picker answer stubbed as `pickFolder` tests do today)
  - a Screen going from progress to live through the proxy against the fake dev server
  - snapshot fallback, Open in browser, the mock tag, Parameters on a Screen, "Looks right"
  - Instance removed
  - the flag-off read-only view

  Prior art: `artifactLive.spec.ts`, `artifactDials.spec.ts`, `addMenu.spec.ts`, `featureFlags.spec.ts`.
- Real Vite and Next stay out of CI. The spike (`.scratch/repositories/research/06-…`) and the stress test (`…/03-…`) covered them. End-to-end proof on real repos happens in the dev app.

## Tasks

1. Add the `repositories` flag and refuse every Repository RPC when it's off. Seam: engine (`featureFlags.test.ts`).
2. Accept only the canvas origin (and the preview origin where already allowed) in the loopback guard. Seam: engine.
3. Resolve the login-shell PATH once with `-ilc` in a shared service, move claude and codex detection onto it, and strip hosting and Electron variables from spawned environments. Seam: engine.
4. Answer each project's kind from `projects.list`, defaulting existing projects to `whiteboard`. Seam: engine.
5. Add a Repository from a folder: resolve the git root, refuse non-repos, name it after the repo, write the record, never touch the repo. Seam: engine.
6. Show "Add Repository…" in the new-project menu when the flag is on, open the folder picker, and list Repositories with their kind. Seam: browser.
7. Shape the run command for npm, pnpm, yarn and bun with `PORT` and the port flag, including `--strictPort` for the Vite family. Seam: domain.
8. Name worktree paths and merge entries into an exclude file idempotently. Seam: domain.
9. Create an Instance: worktree from a base, branch named or generated, `.env*` and Setup's files copied, exclude merged, setup command run. Seam: engine.
10. Remove an Instance: delete the worktree, optionally the branch, refuse on unpushed or unmerged commits unless forced. Seam: engine.
11. Start an Instance on a free port, verify the bound port, expose state and log tail, stop it, kill all on shutdown, sweep leftovers on start. Seam: engine.
12. Rewrite headers for the proxy (Location, Origin on Next dev paths, frame headers) and inject the bridge tag into streamed HTML. Seam: domain.
13. Serve a live Instance through its proxy on `127.0.0.1`: HTML gets the bridge, cookies survive redirects, WebSocket upgrades are forwarded, upstream falls back to `::1`. Seam: engine.
14. Choose which Instance to stop over budget and when an idle Instance stops. Seam: domain.
15. Drive Instances from canvas demand: start demanded ones first and serially, stop over budget and after idle, honour `single` port mode. Seam: engine.
16. Add the `screen` shape: live iframe through the proxy when demanded and visible, snapshot otherwise, kept until first paint. Seam: browser.
17. Snapshot a Screen through headless Chrome against its proxy URL. Seam: engine.
18. Show Screen overlays and actions: setup progress, mock tag, warnings, Instance removed, Repository not found, Open in browser, change route and viewport. Seam: browser.
19. Fork a Screen into a new Instance and create an Instance from a picked base branch. Seam: browser.
20. Give Screens Parameters through the bridge, values per Screen, with Apply sending the instruction into that Instance's worktree thread, and a one-line notice when there's no bridge. Seam: browser.
21. Offer the agent `instance_create`, `instance_remove` and `instance_status`, make `preview_*` and `canvas_*` work on Screens, and hide `page_write` and `motion_write` in a Repository. Seam: engine (scripted agent).
22. Run a thread in its working Instance's worktree, and give forked worktree paths to the thread. Seam: engine.
23. Add the Repository section to the system prompt. Seam: engine (prompt assembly).
24. Open Setup on add and on re-run, with its prompt and tools (`ask_login`, `screen_snapshot`, `setup_save`). `setup_save` records the result and copies Setup's files into worktrees. Seam: engine (scripted agent).
25. Close Setup with "Looks right", or send a rejection note back as the next turn. Seam: browser.
26. Explode an Instance into a Flow from agent-proposed or typed routes. Seam: engine (canvas write) and browser.
27. Show an Instance diff against its merge-base, excluding Setup's files. Seam: engine.
28. Run stacked commit, push and PR actions on an Instance with generated messages. Seam: engine (fake `git` remote and a GitHub API stub).
29. Open existing Repositories read-only with the flag off: snapshots only, no Instance or Setup starts, "Add Repository…" hidden. Seam: browser and engine.
30. Mark a Repository `missing` when its path is gone, and let the person locate it again. Seam: engine and browser.

## Out of Scope

- Creating a new repository or starting from a template.
- Sharing a board through the repo (a canvas committed in git).
- Element editing inside Screens (Design tab, inspect) beyond Parameters.
- PR management actions (merge, squash, auto-merge) and per-turn checkpoints with rollback.
- Record-and-replay of API responses through the proxy.
- Making Setup permanent as a PR into the repo.
- Automatic worktree cleanup rules.
- Separate loopback addresses (`127.0.0.2…`) for truly fixed ports.
- An Electron `<webview>` display path.
- Any change to the desktop shell or the hosting contract.

## Further Notes

- Research and spike write-ups with sources are in `.scratch/repositories/research/` (untracked, local to the planning checkout).
- Known unknowns to watch during real-world testing:
  - macOS folder-access prompts for repos in `~/Documents` or `~/Desktop`
  - the firewall prompt when a dev server binds all interfaces
  - whether `Secure` cookies are accepted on `http://127.0.0.1`
  - the real memory of large Next apps, against the stress test's floor
