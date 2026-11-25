# Screen states and branches

## Problem Statement

A person testing Repositories in the dev app found the Screen toolbar hard to read and the Screen model too narrow:

- The toolbar shows icons for Fork, New Instance and Changes with no sign of which branch a Screen is on, which Screens share code, or when an action makes a new branch and worktree rather than another view of the same one.
- Moving a Screen to another page means typing a route into a text box, and exploding a Flow means typing routes one per line. The person is not expected to know the app's routes.
- A Screen is one route. Many steps a person moves through have no URL of their own: a menu open, a dialog, a half-filled form, an error, a loading state. Unframed itself is an example: almost everything happens on one route. Such states cannot be shown, and Flows of them cannot be drawn.

## Solution

- **Branches, not Instances, in the interface.** The word "Instance" leaves the UI. Each Screen's toolbar starts with a branch chip showing the branch and how many files changed. One menu on it holds everything about code: another view of this branch, a new branch and worktree, another branch, the changes with commit, push and PR, and removing the branch and its worktree. Actions that make a worktree say so. Each Screen's canvas label names its branch. Screens are not coloured by branch.
- **Routes come from navigation and the agent.** The route text box goes. A live Screen follows the person as they navigate inside it, and its label shows where it is. "Keep this view" leaves a copy beside it. "Map a Flow" hands the job to the agent, which builds the Flow on the canvas straight away.
- **A Screen is a state, not only a route.** A Screen holds a route, the steps that reach the state from there (click, type, press), and the mocks that make the state happen (an empty list, a failed request, a slow response). The agent always writes them: it works out the state, proves it by replaying it, and saves it on the Screen. Flows join states with arrows labelled by the action between them. When steps stop working because the app changed, the Screen says so and offers to have the agent fix them.

## User Stories

### The branch chip

1. As a person on a Repository, I want each Screen's toolbar to start with the branch it shows, so that I always know whose code I am looking at.
2. As a person, I want the branch chip to show how many files changed on that branch, so that I can see at a glance there is uncommitted work.
3. As a person, I want one menu on the branch chip for everything about code, so that I do not have to decode separate icons.
4. As a person, I want "Another view of this branch" to add a Screen of the same branch beside this one, so that I can look at two pages of the same code, both updating when the code changes.
5. As a person, I want "New branch and worktree…" to copy this Screen's current code onto a new branch with its own worktree and its own server, so that I can try something without touching the original.
6. As a person, I want the new branch named for me, with the name editable before I confirm, so that forking takes one click but I can still choose.
7. As a person, I want "Open another branch…" to start a worktree from a branch I pick, so that I can bring an existing branch onto the canvas.
8. As a person, I want "Changes" in the same menu to list the changed files and offer Commit, Commit and push, and Commit, push and open PR, so that the branch and its changes live together.
9. As a person, I want "Remove branch and worktree…" in the same menu, warning me about unpushed or uncommitted work, so that I can clean up from where I made it.
10. As a person, I want the menu to say which actions make a new worktree, so that I know when a new server and a new copy of the code are coming.
11. As a person, I never want to see the word "Instance", so that the interface speaks in git words I already know.

### Branches on the canvas

12. As a person, I want each Screen's canvas label to read as its branch and where it is, so that I can tell Screens apart without selecting them.
13. As a person, I want a Flow's label to name its branch, as it does today, so that a whole Flow reads as one branch.
14. As a person, I want Screens not to be coloured by branch, so that the canvas stays calm and the label carries the meaning.

### Navigating a Screen

15. As a person, I want to click and navigate inside a live Screen as in a browser, so that I reach pages by using the app.
16. As a person, I want the Screen to follow me when I navigate, with its label updating to the new page, so that the Screen shows where I am.
17. As a person, I want "Keep this view" to leave a copy of the Screen at its current page beside it, so that I can collect pages as I browse.
18. As a person, I want navigating a Screen to be undoable like any canvas change, so that I can get back a Screen I moved by accident.
19. As a person, I want no text box for routes, so that I never need to know the app's URLs.
20. As a person, I want back and forward in a Screen to follow too, so that history inside the app behaves as expected.

### States with no URL

21. As a person, I want to ask the agent for a state such as "the generate menu open" and get a Screen showing it, so that I can design states that have no URL.
22. As a person, I want the agent to reach a state by acting in the app (clicking, typing, pressing keys), so that the Screen shows the real path a user takes.
23. As a person, I want the agent to make hard-to-reach states, such as an error, an empty list or a slow load, by mocking what the app receives, so that I can see them without breaking my real data.
24. As a person, I want mocks never to change my repository's files, so that states are safe to make and throw away.
25. As a person, I want a Screen's mocks to apply only to that Screen, so that other Screens of the same branch keep showing real data.
26. As a person, I want a Screen that holds a state to replay it whenever it loads or reloads, so that it keeps showing the state after a code change.
27. As a person, I want to see that a Screen holds a state rather than a plain page, and what the state is, so that I know why it looks the way it does.
28. As a person, I want a Screen whose steps no longer work to say "Couldn't reach this state" and show which step failed, so that I never mistake the wrong page for the state.
29. As a person, I want a button on that message that asks the agent to fix the steps, so that a renamed button costs me one click.
30. As a person, I want the agent to check that a state works by replaying it before saving it, so that saved states are known to work.
31. As a person, I want "Another view of this branch" and "New branch and worktree…" to carry a Screen's state along, so that I can compare one state across branches.
32. As a person, I want navigating inside a Screen that holds a state to move it to a plain page, undoably, so that the Screen keeps following me.

### Flows

33. As a person, I want "Map a Flow" on a selected Screen to ask the agent to map the flow from it, so that I can describe a flow in words instead of listing routes.
34. As a person, I want the agent to build the Flow on the canvas straight away, so that I see it without approving a list first.
35. As a person, I want a Flow's steps to be states, not only routes, so that a flow through dialogs and menus can be drawn.
36. As a person, I want each arrow labelled with the action between two states ("click Generate"), so that the Flow reads as what a user does.
37. As a person, I want to ask the agent to change a Flow in chat, so that I adjust it the same way I made it.
38. As a person, I want to undo a Flow the agent built, so that I can throw away a wrong one in one step.

### The agent

39. As a person, I want to tell the agent "show pricing on three new branches" and get three branches with Screens, so that forking into several versions needs no clicks.
40. As a person, I want the agent to save states on Screens through one tool that proves them first, so that its states work the first time I see them.
41. As a person, I want the agent to describe each state in plain words on the Screen, so that I can tell states apart.

### Recording by hand (later)

42. As a person, I may later want to record steps by clicking through a Screen myself, so that I can make a state without the agent. This is out of scope here and noted for later.

## Implementation Decisions

### Vocabulary

- The glossary keeps **Instance** for code, specs and the agent's prompts. The interface says "branch" and "worktree" only.
- The **Screen** entry changes to: one state of one Instance at one viewport size, where a state is a route, plus the steps that reach it and the mocks that make it happen. A Screen with no steps and no mocks is a plain route.
- The **Flow** entry adds: arrows labelled with the action that leads from one Screen to the next.
- New glossary terms: **Steps** (the actions replayed in a Screen after its route loads) and **Mocks** (the responses a Screen's page receives in place of real ones). Avoid: script, recording, macro, fixture, stub.

### Screen shape

- The `screen` shape keeps its route, size, title, Parameters and mode, and gains:
  - `steps`: an ordered list. Each step is one of: click a target, type text into a target, press a key, hover a target, wait for a target, or scroll a target into view.
  - `mocks`: a list of request matchers (method, URL pattern) with the response to give (status, headers, body, delay in ms), or an instruction to fail the request as a network error.
  - `state`: a short plain-words description of the state. When it is empty, the label falls back to the route.
- Targets are named by accessible role and name first ("button Generate"), then by visible text, then by a CSS selector as a last resort. The domain module that checks steps refuses a target with none of these.
- A Screen's canvas label reads `<branch> · <state or route>`. The branch comes from the Screen's Instance, so a renamed branch updates every label.

### The bridge (inside the injected page script)

- The bridge script the proxy already injects grows three jobs, each driven by messages from the Screen:
  - **Navigation report.** It reports the page's location after load, `pushState`, `replaceState`, `popstate` and `hashchange`, as a route relative to the proxy origin.
  - **Mocks.** It wraps `fetch`, `XMLHttpRequest` and `EventSource` before the app's own scripts run, and answers matching requests from the Screen's mocks. Mocks live in the page, not the proxy, so they reach cross-origin APIs and apply to one Screen even though the proxy serves the whole Instance.
  - **Steps.** After the first paint, it replays the steps in order, waiting up to a fixed time for each target to appear. It reports success, or the index of the step that failed and why.
- The bridge gets a Screen's mocks before the app's scripts run: the Screen's iframe URL carries a short-lived token that the proxy turns into the mocks inlined with the injected script. The token is per Screen and per load, and the proxy forgets it after use.
- A page that did not load the bridge (strict CSP, a response that is not HTML) cannot follow navigation, replay steps or apply mocks. The Screen says so in one line, as it does for Parameters today.

### Following navigation

- When the bridge reports a route that differs from the Screen's `route` while the person is interacting with the Screen, the web app writes the new route to the shape as one undoable change and clears `steps`, `mocks` and `state`.
- Navigation caused by replaying steps never rewrites the route.
- "Keep this view" duplicates the Screen at its current route, size and Parameters, without steps or mocks, beside it.

### Branch chip (Screen toolbar)

- The toolbar becomes: drag handle, branch chip, viewport, Open in browser, Map a Flow, Parameters, Agent. The route button, Fork, New Instance, Changes and Explode leave the toolbar.
- The branch chip shows the branch name and, when non-zero, the number of changed files. Its menu holds:
  - Another view of this branch
  - New branch and worktree…, with the name prefilled and editable (today's Fork)
  - Open another branch…, with base and name (today's New Instance)
  - Changes (n), with the file list and the three git actions
  - Remove branch and worktree…
- "Another view" and "New branch and worktree…" copy the Screen's route, steps, mocks, state, size and Parameters.
- The `Instance` record gains `changes`: the number of changed files on the branch, Setup's excluded files left out, as `instances.diff` counts them. The engine refreshes it from the worktree watcher, debounced, and publishes it with the Instance's other state.

### Agent

- New tool `screen_state` (flag-gated, Repository only) with input: Screen, route, steps, mocks, and a plain-words state. The engine loads the route in headless Chrome against the Instance's proxy with the mocks applied, replays the steps through the same bridge, and then:
  - On success, it writes the state onto the Screen, or onto a new Screen when asked, and answers with a snapshot.
  - On failure, it changes nothing and answers with the failed step and a snapshot of where it stopped.
- `screen_explode` is replaced by `flow_create`: input is a starting Screen and an ordered list of states (route, steps, mocks, state, and the action label of the arrow into it). Each state is proved like `screen_state`, and the Flow is built as one undoable batch. If any state fails, nothing is built and the answer names it.
- The existing `preview_*` tools on a Screen remain the agent's way to explore before it saves a state.
- "Map a Flow" in the toolbar sends the agent an instruction (model-facing text in `assets/prompts/`) to explore from the selected Screen and call `flow_create`, which replaces today's flow instruction. The routes text box goes.
- "Ask the agent to fix it" on a broken state sends an instruction naming the Screen, its steps and the failed step, asking for a corrected `screen_state`.
- The Repository section of the system prompt gains: states and how to make them, mocks over code changes, and one tool call per state.

### Delivery

- Everything stays behind the `repositories` flag. With the flag off, Screens with steps and mocks still render their snapshots read-only.
- Lands by PR into `feat/repositories`.

## Testing Decisions

- Good tests check behaviour as a caller sees it: RPC answers, shapes on the canvas, what the page shows, what the agent's tool returns. They never check the bridge's internals.
- **Engine seam (Vitest, real engine)**, the main seam for states:
  - `screen_state` proves and saves a state against the fake dev server: a click step that opens a menu, a type step, a mock that turns a list request into an empty list, a mock that fails a request.
  - A failing step leaves the Screen unchanged and names the step.
  - `flow_create` builds a Flow of states with labelled arrows as one batch, and builds nothing when one state fails.
  - The Instance's `changes` count follows edits in the worktree.
  - The mock token is single-use and per Screen.
  - The fake dev server grows a page with a button that opens a menu and a list fetched from an endpoint.
  - Prior art: `flows.test.ts`, `agentInstances.test.ts`, `instanceProxy.test.ts`, `repositoryAgent.ts`.
- **Domain seam (Vitest, pure logic)**: step and target validation, mock matching (method, URL pattern, first match wins), the Screen label, the branch chip's text, the rule that a user navigation clears a state, and arrow labels. Prior art: `screens.test.ts`, `instanceProxy.test.ts`.
- **Browser seam (Playwright against the running app)**: the branch chip and each menu item; a Screen following navigation, undo bringing it back; Keep this view; a Screen holding a state, showing it after reload; the "Couldn't reach this state" overlay and its fix button sending the instruction; Map a Flow sending the instruction; no "Instance" text anywhere in the Screen UI. Prior art: `screens.spec.ts`.
- Real frameworks stay out of CI. A state on a real Vite app is proven in the dev app before merging.

## Tasks

1. Update the glossary entries for Screen and Flow, and add Steps and Mocks. Seam: none (docs).
2. Validate steps and targets, and match mocks to requests. Seam: domain.
3. Label a Screen `<branch> · <state or route>` and show it on the canvas. Seam: domain, then browser.
4. Publish a `changes` count on each Instance from the worktree watcher. Seam: engine.
5. Replace the route button, Fork, New Instance and Changes with the branch chip and its menu, carrying a Screen's state into new views and branches. Seam: browser.
6. Report navigation from the bridge and have the Screen follow it as one undoable change. Seam: engine (bridge messages through the proxy), then browser.
7. Add Keep this view. Seam: browser.
8. Apply a Screen's mocks in the page through a per-load token. Seam: engine.
9. Replay a Screen's steps after first paint and report success or the failed step. Seam: engine.
10. Show "Couldn't reach this state" with the failed step, and have its button send the fix instruction to the agent. Seam: browser.
11. Add the `screen_state` tool, which proves a state headlessly and saves it. Seam: engine.
12. Replace `screen_explode` with `flow_create`, with labelled arrows and all-or-nothing building. Seam: engine.
13. Replace Explode with Map a Flow, which sends the agent the flow instruction. Seam: browser.
14. Add states and mocks to the Repository section of the system prompt. Seam: engine (prompt assembly).
15. Keep states read-only with the flag off. Seam: engine and browser feature-flag tests.
16. Prove a state and a Flow of states on a real repo in the dev app. Seam: manual, dev app.

## Out of Scope

- Recording steps by hand from the person's own clicks. The person called this a possible later option, kept secondary to the agent.
- Mocks at the proxy or in the repository's code.
- Colouring or grouping Screens by branch.
- Choosing a route by typing it, anywhere in the interface.
- Merging branches, managing PRs, and checkpoints, as in the Repositories spec.
- States that need browser storage or cookies set before load. Steps can reach them through the app; direct seeding can come later.

## Further Notes

- This came from the first hands-on test of Repositories in the dev app. In the same session: the Setup spinner on Screens (PR #248), and removing the 30-step cap on Claude turns (PR #249).
- The spec builds on `docs/specs/repositories.md`, and its Screen and Agent sections describe what this one changes.
- Replaying steps in the page, rather than through headless Chrome, keeps live Screens and the agent's proof on one code path: the bridge. Headless Chrome only hosts the page while the agent proves a state.
