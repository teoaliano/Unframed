# Unframed

A local canvas where a person arranges material and turns a selection into new material, through a paid generation or a local coding agent.

## Projects

**Project**:
One canvas and the material behind it. Every project is either a Whiteboard or a Repository.

**Whiteboard**:
A project whose material is a folder of files Unframed owns: images, videos, prompts, pages and motions.
_Avoid_: Folder project, regular project

**Repository**:
A project whose material is a git repository the person already has, shown on the canvas as running Instances of its frontend.
_Avoid_: Repo project, code project, app project

**Instance**:
One branch of a Repository, checked out in its own worktree and running its frontend. Several versions of the app are several Instances. The word belongs to code, specs and the agent's prompts; the interface says branch and worktree.
_Avoid_: Version, variant, preview

**Setup**:
The agent thread that makes a Repository run on the canvas: it works out what this repo needs and proves a Screen shows real content, not an error or a login wall. Everything it adds is ignored by git.
_Avoid_: Onboarding, configuration, install

**Screen**:
One tile on a Repository's canvas: one state of one Instance at one viewport size, where a state is a route, plus the Steps that reach it and the Mocks that make it happen. A Screen with no Steps and no Mocks is a plain route. An Instance can show many Screens.
_Avoid_: Page, frame, tile

**Steps**:
The actions replayed in a Screen after its route loads: click, type, press a key, hover, wait for or scroll to a target.
_Avoid_: Script, recording, macro

**Mocks**:
The responses a Screen's page receives in place of real ones: a status, headers, a body and a delay, or a failed request. They apply to that Screen alone and never change the repository.
_Avoid_: Fixture, stub

**Flow**:
A group of Screens from the same Instance, laid out in order and joined by arrows labelled with the action that leads from one Screen to the next, and labelled with the Instance's branch.
_Avoid_: Journey, sequence

**Design mode**:
Editing one Screen's elements on the canvas itself: the person selects elements in the running page and changes them with handles, keys and the Design panel. Each change is a draft until Apply.
_Avoid_: Edit mode (the Screen editor tab's own mode), inspect mode

**Draft**:
One change a person made by hand to a Screen's element (a style, its text, its order, a copy, a deletion, a wrapper, hiding it, a prop) that previews on the live page and is not yet in the code. Apply writes the drafts it can and hands the rest to the Screen's agent.
_Avoid_: Override, pending change

## Analysis

**Code map**:
What Unframed knows about a Repository's code, written per Instance by analysis: the stack, the routes, dialogs, flags, and the features and notes the agent adds.
_Avoid_: Sitemap, manifest

**Design-system index**:
The app's own components (file, props, variants, how often they are used) and design tokens, so the agent reuses them.
_Avoid_: Component library, registry

**Token scale**:
A Repository's design tokens as the canvas uses them, read from its CSS and Design-system index: colours grouped by meaning and component, spacing (the Scale and the project's own Semantic values), sizes, radii, type, weights and shadows, with each alias chain. Drags snap to it and the Design panel names its steps.
_Avoid_: Theme, palette, token list

**States index**:
For each route, the visible cases its import closure contains (empty, error, loading, a role, a dialog), plus the prepared states the agent has proven for it.
_Avoid_: Variants, scenarios

**Mock files**:
A Repository's fake backend, written by Setup as files under `.unframed/mocks/`: request handlers, Collections of rows they read and write, and Switches a Screen's route can set. A Screen's own Mocks answer before them.
_Avoid_: Fixtures, stubs, fake API

**Frozen state**:
A Screen's location, storage, Collections and typed field values saved under a content id, restored before the app boots whenever the Screen loads.
_Avoid_: Snapshot (a snapshot is a picture), checkpoint
