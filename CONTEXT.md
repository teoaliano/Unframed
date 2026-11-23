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
One branch of a Repository, checked out in its own worktree and running its frontend. Several versions of the app are several Instances.
_Avoid_: Version, variant, preview

**Setup**:
The agent thread that makes a Repository run on the canvas: it works out what this repo needs and proves a Screen shows real content, not an error or a login wall. Everything it adds is ignored by git.
_Avoid_: Onboarding, configuration, install

**Screen**:
One tile on a Repository's canvas: one route of one Instance at one viewport size. An Instance can show many Screens.
_Avoid_: Page, frame, tile

**Flow**:
A group of Screens from the same Instance, laid out in order and joined by arrows, labelled with the Instance's branch.
_Avoid_: Journey, sequence
