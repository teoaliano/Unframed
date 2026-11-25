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
